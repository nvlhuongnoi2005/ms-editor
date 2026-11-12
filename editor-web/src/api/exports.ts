export interface ExportJob {
  id: string;
  state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
  totalCount: number | null;
  phase: string;
  cancelRequested: boolean;
  revision: number | null;
  entityCount: number;
  bytes: number;
  sha256: string | null;
  error: string | null;
  created_at: string;
}

export interface ExportJobs { jobs: ExportJob[]; workerOnline: boolean }
export class ExportRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function loadExport(id: string, signal: AbortSignal): Promise<ExportJob> {
  return readResponse(await fetch(`/api/exports/${encodeURIComponent(id)}`, { signal, cache: 'no-store' }));
}

async function readResponse<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new ExportRequestError(response.status, value.error || 'Không thể xử lý yêu cầu xuất PBF.');
  return value as T;
}

export async function loadExports(dataset: string, signal: AbortSignal): Promise<ExportJobs> {
  return readResponse(await fetch(`/api/exports?${new URLSearchParams({ dataset })}`, { signal, cache: 'no-store' }));
}

export async function createExport(dataset: string, signal: AbortSignal): Promise<{ id: string }> {
  return readResponse(await fetch(`/api/exports?${new URLSearchParams({ dataset })}`, {
    method: 'POST', headers: { 'X-Editor-Import': '1' }, signal,
  }));
}

export async function cancelExport(id: string, signal: AbortSignal): Promise<{ state: ExportJob['state'] }> {
  const response = await fetch(`/api/exports/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: { 'X-Editor-Import': '1' }, signal,
  });
  if (response.status === 404) throw new Error('API đang chạy chưa hỗ trợ dừng xuất. Cần khởi động lại API bằng mã mới và cập nhật export-worker.');
  return readResponse(response);
}
