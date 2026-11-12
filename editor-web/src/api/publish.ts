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

export async function loadPublishStatus(dataset: string, signal?: AbortSignal): Promise<PublishStatus> {
  const response = await fetch(`/api/publish-status?${new URLSearchParams({ dataset })}`, { signal, cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Không thể tải trạng thái publish (${response.status}).`);
  if (!isPublishStatus(payload)) throw new Error('Trạng thái publish không hợp lệ.');
  return payload;
}

// One owner for timers and requests, including manual refreshes after a save.
// Hidden tabs do no work; becoming visible immediately reconciles revisions.
export class PublishStatusPoller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: AbortController | null = null;
  private stopped = false;
  private again = false;
  private failures = 0;
  private fastUntil = 0;
  private status: PublishStatus | null = null;
  constructor(private load: (signal: AbortSignal) => Promise<PublishStatus>, private receive: (value: PublishStatus) => void,
    private visibility = document) {
    visibility.addEventListener('visibilitychange', this.visibilityChanged);
    this.refresh(false);
  }
  private visibilityChanged = () => {
    if (this.visibility.visibilityState === 'hidden') {
      clearTimeout(this.timer);
      this.active?.abort();
    } else this.refresh(false);
  };
  refresh(fast = true) {
    if (this.stopped) return;
    if (fast) this.fastUntil = Date.now() + 15_000;
    clearTimeout(this.timer);
    if (this.visibility.visibilityState === 'hidden') return;
    if (this.active) { this.again = true; return; }
    void this.poll();
  }
  private async poll() {
    const controller = new AbortController();
    this.active = controller;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    try {
      const value = await this.load(controller.signal);
      if (!this.stopped && !controller.signal.aborted) {
        this.status = value; this.failures = 0; this.receive(value);
      }
    } catch { if (!this.stopped) this.failures = Math.min(5, this.failures + 1); }
    finally {
      clearTimeout(deadline);
      this.active = null;
      if (this.stopped || this.visibility.visibilityState === 'hidden') return;
      if (this.again) { this.again = false; this.refresh(false); return; }
      const busy = this.status?.status === 'pending' || this.status?.status === 'rendering' || Date.now() < this.fastUntil;
      const delay = this.failures ? Math.min(60_000, 3000 * 2 ** this.failures) : busy ? 3000 : 60_000;
      this.timer = setTimeout(() => this.refresh(false), delay * (0.9 + Math.random() * 0.2));
    }
  }
  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.active?.abort();
    this.visibility.removeEventListener('visibilitychange', this.visibilityChanged);
  }
}
