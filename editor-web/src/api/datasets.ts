export type DatasetBounds = [number, number, number, number];
export interface DatasetInfo { id: string; name: string; state: 'ready'; bounds: DatasetBounds | null; canonicalRevision: number; renderRevision: number }
export type ImportState = 'queued' | 'canonical' | 'render' | 'indexing' | 'ready' | 'failed';
export interface ImportJob {
  id: string; dataset: string; filename: string; bytes: number; state: ImportState;
  nodes: number; ways: number; relations: number; attempts: number; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface ImportStatus { jobs: ImportJob[]; workerOnline: boolean; maxUploadBytes: number }

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function parseDataset(value: unknown): DatasetInfo {
  if (!record(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || value.state !== 'ready'
    || typeof value.canonicalRevision !== 'number' || typeof value.renderRevision !== 'number') throw new Error('Dataset không hợp lệ.');
  const bounds = value.bounds;
  if (bounds !== null && (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(item => typeof item === 'number' && Number.isFinite(item))
    || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -90 || bounds[3] > 90 || bounds[0] > bounds[2] || bounds[1] > bounds[3])) throw new Error('Phạm vi dataset không hợp lệ.');
  return value as unknown as DatasetInfo;
}
export function parseImportStatus(value: unknown): ImportStatus {
  if (!record(value) || !Array.isArray(value.jobs) || typeof value.workerOnline !== 'boolean' || typeof value.maxUploadBytes !== 'number') throw new Error('Tiến trình import không hợp lệ.');
  const states = ['queued', 'canonical', 'render', 'indexing', 'ready', 'failed'];
  for (const job of value.jobs) {
    if (!record(job) || !['id', 'dataset', 'filename', 'createdAt'].every(key => typeof job[key] === 'string') || !states.includes(job.state as string)
      || !['bytes', 'nodes', 'ways', 'relations', 'attempts'].every(key => typeof job[key] === 'number') || (job.error !== null && typeof job.error !== 'string')) throw new Error('Tác vụ import không hợp lệ.');
  }
  return value as unknown as ImportStatus;
}
async function jsonResponse(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(record(body) && typeof body.error === 'string' ? body.error : `API dữ liệu lỗi (${response.status}). Hãy khởi động lại Editor API bản mới.`);
  return body;
}
export async function loadDatasets(signal?: AbortSignal): Promise<DatasetInfo[]> {
  const timeout = AbortSignal.timeout(10_000);
  const body = await jsonResponse(await fetch('/api/datasets', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout }));
  if (!record(body) || !Array.isArray(body.datasets)) throw new Error('Danh sách dataset không hợp lệ.');
  return body.datasets.map(parseDataset);
}
export async function loadImports(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(10_000);
  return parseImportStatus(await jsonResponse(await fetch('/api/imports', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })));
}
export async function retryImport(id: string) {
  await jsonResponse(await fetch(`/api/imports/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: { 'X-Editor-Import': '1' } }));
}
export function uploadPBF(file: File, dataset: string, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const finish = () => signal?.removeEventListener('abort', abort);
    const abort = () => request.abort();
    request.open('POST', `/api/imports?${new URLSearchParams({ dataset })}`);
    request.setRequestHeader('X-Editor-Import', '1');
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
    request.onload = () => {
      finish();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(request.responseText); } catch { /* HTTP status still available */ }
      if (request.status === 202) resolve();
      else reject(new Error(typeof body.error === 'string' ? body.error : `Không upload được PBF (${request.status}).`));
    };
    request.onerror = () => { finish(); reject(new Error('Mất kết nối khi upload PBF.')); };
    request.onabort = () => { finish(); reject(new DOMException('Upload đã huỷ.', 'AbortError')); };
    if (signal?.aborted) { reject(new DOMException('Upload đã huỷ.', 'AbortError')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData(); form.append('file', file); request.send(form);
  });
}
