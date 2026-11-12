// Sequential polling for background job dialogs. The task returns its next
// interval; failures back off, hidden tabs stop, and reopening is immediate.
export function startVisiblePolling(task: (signal: AbortSignal) => Promise<number>, visibility = document) {
  let stopped = false, active: AbortController | null = null, again = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    if (stopped || visibility.visibilityState === 'hidden') return;
    if (active) { again = true; return; }
    void poll();
  };
  const poll = async () => {
    const controller = new AbortController(); active = controller;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    let delay = 30_000;
    try { delay = await task(controller.signal); failures = 0; }
    catch { failures = Math.min(5, failures + 1); delay = Math.min(60_000, 3000 * 2 ** failures); }
    finally {
      clearTimeout(deadline); active = null;
      if (!stopped && visibility.visibilityState !== 'hidden') {
        if (again) { again = false; refresh(); }
        else timer = setTimeout(refresh, delay * (0.9 + Math.random() * 0.2));
      }
    }
  };
  const changed = () => { if (visibility.visibilityState === 'hidden') { clearTimeout(timer); active?.abort(); } else refresh(); };
  visibility.addEventListener('visibilitychange', changed);
  refresh();
  return { refresh, dispose() { stopped = true; clearTimeout(timer); active?.abort(); visibility.removeEventListener('visibilitychange', changed); } };
}
