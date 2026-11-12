import type { DownloadFile, DownloadReply, DownloadRequest, DownloadState } from './downloadTypes';

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
export const supportsManagedDownload = () => window.isSecureContext && typeof navigator.storage?.getDirectory === 'function'
  && typeof navigator.locks?.request === 'function' && typeof (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker === 'function';

// One manager per dataset/tab survives closing the dialog. A full reload only
// restores metadata and waits for an explicit Resume click.
class PBFDownload {
  private worker: Worker;
  private state: DownloadState = { mode: 'initializing', file: null, offset: 0, error: null };
  private listeners = new Set<() => void>();
  private pending = new Map<number, { resolve: (reply: DownloadReply) => void; reject: (error: Error) => void }>();
  private sequence = 0;
  private failure: Error | null = null;
  private saving: AbortController | null = null;
  private saveTask: Promise<void> | null = null;
  private starting = false;
  private pausedSave = false;
  private destination: FileSystemFileHandle | null = null;
  readonly ready: Promise<void>;

  constructor(dataset: string) {
    this.worker = new Worker(new URL('./pbfDownload.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<DownloadReply>) => {
      this.set(data.state);
      if (data.seq !== undefined) {
        const request = this.pending.get(data.seq); this.pending.delete(data.seq);
        if (data.failed) request?.reject(new Error(data.state.error || 'Không thể xử lý tác vụ tải.'));
        else request?.resolve(data);
      }
    };
    this.worker.onerror = () => {
      const error = new Error('Không thể truy cập dữ liệu tải dở. Hãy tải lại trang rồi thử tiếp tục.');
      this.failure = error;
      this.set({ ...this.state, mode: this.state.file ? 'paused' : 'idle', error: error.message });
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.ready = this.initialize(dataset).catch(error => { this.set({ ...this.state, mode: 'idle', error: error instanceof Error ? error.message : 'Không mở được bộ nhớ tải tạm.' }); });
    // pagehide also covers back/forward cache. Never resume automatically on pageshow.
    window.addEventListener('pagehide', () => { void this.pause().catch(() => {}); });
  }
  private async initialize(dataset: string) {
    const session = await navigator.locks.request('osm-pbf-download-client', () => {
      let value = localStorage.getItem('osm-pbf-download-client');
      if (!value) { value = crypto.randomUUID(); localStorage.setItem('osm-pbf-download-client', value); }
      return value;
    });
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataset));
    const key = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    await this.call({ action: 'init', directory: `osm-download-${session}-${key}` });
  }
  private set(state: DownloadState) { this.state = state; for (const listener of this.listeners) listener(); }
  private call(request: Omit<DownloadRequest, 'seq'>) {
    if (this.failure) return Promise.reject<DownloadReply>(this.failure);
    const seq = ++this.sequence;
    return new Promise<DownloadReply>((resolve, reject) => { this.pending.set(seq, { resolve, reject }); this.worker.postMessage({ ...request, seq }); });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  async start(file: DownloadFile) {
    if (this.starting) return;
    this.starting = true;
    try {
      await this.ready;
      await navigator.storage.persist().catch(() => false);
      this.pausedSave = false; this.destination = null;
      this.set({ mode: 'downloading', file, offset: 0, error: null });
      await this.call({ action: 'start', file });
    } finally { this.starting = false; }
  }
  async resume() {
    if (this.pausedSave) {
      this.pausedSave = false;
      this.set({ ...this.state, mode: 'ready', error: null });
      await this.save(); return;
    }
    await this.ready; this.set({ ...this.state, mode: 'downloading', error: null }); await this.call({ action: 'resume' });
  }
  async pause() {
    if (this.saving) { this.pausedSave = true; this.saving.abort(); await this.saveTask; return; }
    await this.ready; await this.call({ action: 'pause' });
  }
  async stop() {
    this.pausedSave = false;
    if (this.saving) { this.saving.abort(); await this.saveTask; }
    await this.ready;
    this.set({ ...this.state, mode: 'stopping', error: null });
    await this.call({ action: 'stop' });
    this.destination = null;
  }
  // Call directly from a user gesture: the browser requires it for the picker.
  save() {
    if (!this.state.file || this.state.mode !== 'ready' || this.saving) return Promise.resolve();
    const file = this.state.file;
    const picker = this.destination ? Promise.resolve(this.destination) : (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker({
      suggestedName: file.filename, types: [{ description: 'OpenStreetMap PBF', accept: { 'application/octet-stream': ['.pbf'] } }],
    });
    const abort = new AbortController(); this.saving = abort;
    this.saveTask = (async () => {
      let writer: FileSystemWritableFileStream | null = null;
      try {
        const destination = await picker;
        this.destination = destination;
        if (abort.signal.aborted) { if (this.pausedSave) this.set({ ...this.state, mode: 'paused' }); return; }
        const reply = await this.call({ action: 'file' });
        writer = await destination.createWritable();
        this.set({ ...this.state, mode: 'saving', error: null });
        // File is a disk-backed OPFS snapshot; stream it, never arrayBuffer/blob.
        await reply.file!.stream().pipeTo(writer, { signal: abort.signal });
        writer = null;
        await this.call({ action: 'stop' }); // Saving succeeded: cache is no longer needed.
        this.destination = null; this.pausedSave = false;
        this.set({ mode: 'saved', file, offset: file.total, error: null });
      } catch (error) {
        await writer?.abort().catch(() => {});
        this.set({ ...this.state, mode: this.pausedSave ? 'paused' : 'ready', error: error instanceof DOMException && error.name === 'AbortError' ? null : 'Chưa lưu được file. Dữ liệu tải về vẫn được giữ để bạn thử lại.' });
      } finally { this.saving = null; }
    })();
    return this.saveTask;
  }
}
const downloads = new Map<string, PBFDownload>();
export function getPBFDownload(dataset: string) {
  if (!supportsManagedDownload()) return null;
  let download = downloads.get(dataset);
  if (!download) { download = new PBFDownload(dataset); downloads.set(dataset, download); }
  return download;
}
