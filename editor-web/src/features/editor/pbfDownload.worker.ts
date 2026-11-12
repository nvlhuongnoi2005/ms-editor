import type { DownloadFile, DownloadReply, DownloadRequest, DownloadState } from './downloadTypes';
import { sha256 } from '@noble/hashes/sha2.js';

// OPFS sync writes happen only here, off the editor's UI thread. Each HTTP
// range is streamed, flushed, then checkpointed; reload never starts a fetch.
interface SyncAccess {
  read(data: Uint8Array, options: { at: number }): number;
  write(data: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
type SyncFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<DownloadRequest>) => void) | null; postMessage(value: DownloadReply): void };
const RANGE = 32 * 1024 ** 2;
let directory: FileSystemDirectoryHandle;
let initialized = false;
let metadata: (DownloadFile & { offset: number }) | null = null;
let state: DownloadState = { mode: 'idle', file: null, offset: 0, error: null };
let controller: AbortController | null = null;
let pauseRequested = false;
let verifiedFile: File | null = null;
let queue: Promise<void> = Promise.resolve();
const emit = (seq?: number, failed = false, file?: File) => scope.postMessage({ seq, state: { ...state }, failed, file });
function fail(message: string): never { throw new Error(message); }
function message(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Không đủ dung lượng lưu tạm. Hãy giải phóng dung lượng rồi tiếp tục, hoặc dừng để xóa dữ liệu tải dở.';
  return error instanceof Error ? error.message : 'Tải chưa thành công. Dữ liệu đã ghi được giữ lại để bạn tiếp tục.';
}
async function checkpoint() {
  const handle = await directory.getFileHandle('checkpoint.json', { create: true });
  const writer = await handle.createWritable();
  try { await writer.write(JSON.stringify(metadata)); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}
async function remove(name: string) {
  try { await directory.removeEntry(name); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
}
async function restore() {
  try {
    const checkpointFile = await (await directory.getFileHandle('checkpoint.json')).getFile();
    const value = JSON.parse(await checkpointFile.text());
    if (!value || typeof value.id !== 'string' || typeof value.dataset !== 'string' || typeof value.filename !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.total) || value.total < 0
      || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > value.total) fail('Không đọc được dữ liệu tải dở. Hãy dừng tải để xóa cache rồi tải lại.');
    metadata = value;
    state = { mode: 'paused', file: metadata, offset: metadata!.offset, error: null };
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}
async function checkSpace() {
  const estimate = await navigator.storage.estimate();
  if (estimate.quota !== undefined && estimate.usage !== undefined && metadata && metadata.offset < metadata.total
    && estimate.quota - estimate.usage < metadata.total - metadata.offset + 8 * 1024 ** 2) {
    fail('Dung lượng lưu tạm của trình duyệt không đủ cho file này. Hãy giải phóng dung lượng hoặc tải bằng trình duyệt.');
  }
}
async function verify(handle: SyncFile) {
  if (!metadata || pauseRequested) return;
  verifiedFile = null;
  const access = await handle.createSyncAccessHandle();
  const hash = sha256.create();
  const buffer = new Uint8Array(1024 ** 2);
  let checked = 0, lastUpdate = 0, nextYield = 8 * 1024 ** 2;
  state = { mode: 'verifying', file: metadata, offset: metadata.offset, checked: 0, error: null }; emit();
  try {
    while (checked < metadata.total) {
      if (pauseRequested) { state.mode = 'paused'; return; }
      const length = access.read(buffer.subarray(0, Math.min(buffer.length, metadata.total - checked)), { at: checked });
      if (length <= 0) fail('File tạm chưa đầy đủ. Hãy dừng tải, xóa cache và tải lại.');
      hash.update(buffer.subarray(0, length)); checked += length;
      if (performance.now() - lastUpdate >= 250) { state.checked = checked; emit(); lastUpdate = performance.now(); }
      // Let Pause/Stop messages run while hashing 30–100 GB in this worker.
      if (checked >= nextYield) { nextYield = checked + 8 * 1024 ** 2; await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    if (pauseRequested) { state.mode = 'paused'; return; }
    const actual = [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== metadata.sha256) {
      state.verificationFailed = true;
      fail('Kiểm tra toàn vẹn không thành công. Hãy dừng tải, xóa cache và tải lại file.');
    }
  } finally { hash.destroy(); access.close(); }
  if (!pauseRequested) {
    verifiedFile = await handle.getFile();
    if (pauseRequested) { verifiedFile = null; state.mode = 'paused'; emit(); return; }
    if (verifiedFile.size !== metadata.total) { verifiedFile = null; fail('File tạm đã thay đổi. Hãy dừng tải và tải lại.'); }
    state.mode = 'ready'; state.checked = checked;
  }
  emit();
}
async function download() {
  if (!metadata) return;
  await checkSpace();
  verifiedFile = null;
  const handle = await directory.getFileHandle('data.partial', { create: true }) as SyncFile;
  if ((await handle.getFile()).size < metadata.offset) fail('Cache tải dở không còn đầy đủ. Hãy dừng tải để xóa cache rồi tải lại.');
  const access = await handle.createSyncAccessHandle();
  const abort = new AbortController(); controller = abort;
  let committed = metadata.offset, position = committed, lastUpdate = 0;
  state = { mode: 'downloading', file: metadata, offset: committed, error: null }; emit();
  try {
    access.truncate(committed); // Discard only an uncheckpointed tail after reload.
    while (committed < metadata.total && !abort.signal.aborted && !pauseRequested) {
      const end = Math.min(metadata.total, committed + RANGE) - 1;
      const response = await fetch(`/api/exports/${encodeURIComponent(metadata.id)}/file`, {
        headers: { Range: `bytes=${committed}-${end}`, 'If-Range': `"${metadata.sha256}"` },
        cache: 'no-store', signal: abort.signal,
      });
      if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${committed}-${end}/${metadata.total}`
        || response.headers.get('ETag') !== `"${metadata.sha256}"` || !response.body) {
        await response.body?.cancel();
        fail('Không thể tiếp tục đúng file đã chọn. Hãy dừng tải để xóa cache và tạo lại file.');
      }
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (position + value.byteLength > end + 1) fail('Dữ liệu tải về không đúng kích thước. Hãy thử tiếp tục.');
          let written = 0;
          while (written < value.byteLength) {
            const length = access.write(value.subarray(written), { at: position });
            if (length <= 0) fail('Không ghi được dữ liệu xuống đĩa. Hãy kiểm tra dung lượng trống.');
            written += length; position += length;
          }
          if (performance.now() - lastUpdate >= 250) { state.offset = position; emit(); lastUpdate = performance.now(); }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (position !== end + 1) fail('Kết nối bị gián đoạn. Bạn có thể tiếp tục từ phần đã lưu.');
      access.flush();
      const previous = metadata.offset;
      metadata.offset = position;
      try { await checkpoint(); }
      catch (error) { metadata.offset = previous; throw error; }
      committed = position; state.offset = committed; emit();
    }
    state.mode = 'paused';
  } catch (error) {
    state.mode = 'paused'; state.offset = committed;
    if (!abort.signal.aborted) state.error = message(error);
  } finally {
    try { access.truncate(committed); access.flush(); } finally { access.close(); controller = null; }
    if (committed === metadata.total && !pauseRequested && !state.error) { state.mode = 'verifying'; state.checked = 0; }
    emit();
  }
  if (committed === metadata.total && !pauseRequested && !state.error) await verify(handle);
}
async function execute(request: DownloadRequest) {
  if (request.action === 'init') {
    const root = await navigator.storage.getDirectory();
    // Hold a browser-wide lock for this session/cache until the worker dies.
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request(`pbf:${request.directory}`, { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('Tác vụ tải đang mở ở tab khác. Hãy đóng tab đó rồi thử lại.')); return; }
        try { directory = await root.getDirectoryHandle(request.directory!, { create: true }); await restore(); initialized = true; resolve(); }
        catch (error) { reject(error); }
        await new Promise(() => {});
      }).catch(reject);
    });
  } else {
    if (!directory || (!initialized && request.action !== 'stop')) fail('Không mở được dữ liệu tải tạm. Hãy đóng tab đang tải khác và tải lại trang.');
  }
  if (request.action === 'start') {
    if (metadata) fail('Hãy tiếp tục hoặc dừng tác vụ tải hiện tại trước.');
    const file = request.file!;
    if (!file || !Number.isSafeInteger(file.total) || file.total < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) fail('Thông tin file chưa sẵn sàng. Hãy mở lại cửa sổ xuất.');
    metadata = { ...file, offset: 0 };
    state = { mode: 'paused', file: metadata, offset: 0, error: null };
    await checkpoint(); await download();
  } else if (request.action === 'resume') {
    state.error = null; await download();
  } else if (request.action === 'pause') {
    verifiedFile = null;
    if (metadata) state.mode = 'paused';
  } else if (request.action === 'stop') {
    // Delete bytes before metadata so a failed delete remains retryable.
    await remove('data.partial'); await remove('checkpoint.json');
    initialized = true;
    verifiedFile = null;
    metadata = null; state = { mode: 'idle', file: null, offset: 0, error: null };
  } else if (request.action === 'file') {
    if (!metadata || metadata.offset !== metadata.total || !verifiedFile || state.mode !== 'ready') fail('File chưa được xác nhận toàn vẹn. Hãy tiếp tục để kiểm tra trước khi lưu.');
    emit(request.seq, false, verifiedFile); return;
  }
  emit(request.seq);
}
scope.onmessage = ({ data }) => {
  if (data.action === 'pause' || data.action === 'stop') { pauseRequested = true; controller?.abort(); }
  if (data.action === 'start' || data.action === 'resume') pauseRequested = false;
  queue = queue.then(() => execute(data)).catch(error => {
    state.error = message(error);
    if (metadata) { state.mode = 'paused'; state.offset = metadata.offset; state.file = metadata; }
    emit(data.seq, true);
  });
};
