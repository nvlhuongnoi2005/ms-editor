export interface ExportJob {
  id: string;
  state: 'queued' | 'running' | 'ready' | 'failed';
  revision: number | null;
  entityCount: number;
  bytes: number;
  sha256: string | null;
  error: string | null;
  created_at: string;
}

export interface ExportJobs { jobs: ExportJob[]; workerOnline: boolean }

async function readResponse<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Không thể xử lý yêu cầu xuất PBF.');
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
