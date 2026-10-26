export interface PublishStatus {
  dataset: string;
  status: 'pending' | 'rendering' | 'published' | 'failed';
  canonicalRevision: number;
  renderRevision: number;
  pendingEvents: number;
  lastError?: string | null;
}

function isPublishStatus(value: unknown): value is PublishStatus {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return (status === 'pending' || status === 'rendering' || status === 'published' || status === 'failed')
    && typeof (value as { canonicalRevision?: unknown }).canonicalRevision === 'number'
    && typeof (value as { renderRevision?: unknown }).renderRevision === 'number';
}

export async function loadPublishStatus(dataset: string): Promise<PublishStatus> {
  const response = await fetch(`/api/publish-status?${new URLSearchParams({ dataset })}`);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Không thể tải trạng thái publish (${response.status}).`);
  if (!isPublishStatus(payload)) throw new Error('Trạng thái publish không hợp lệ.');
  return payload;
}
