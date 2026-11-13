/** Keep one in-flight write and the latest complete immutable snapshot, including history. */
export function createDraftWriter<T>(write: (value: T) => Promise<void>, onError: (error: unknown) => void, delay = 16) {
  let latest: { value:T } | undefined;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failed = false, failure: unknown;
  const flush = (): Promise<void> => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (failed) return Promise.reject(failure);
    if (running) return running;
    if (!latest) return Promise.resolve();
    running = (async () => {
      while (latest) {
        const snapshot = latest; latest = undefined;
        try { await write(snapshot.value); }
        catch (error) { latest ??= snapshot; failed = true; failure = error; onError(error); throw error; }
      }
    })().finally(() => {
      running = undefined;
      if(latest && !failed && timer===undefined) timer=setTimeout(()=>{timer=undefined;void flush().catch(()=>{});},delay);
    });
    return running;
  };
  return {
    schedule(value:T) {
      if (failed) return;
      latest = { value };
      if (!running && timer === undefined) timer = setTimeout(() => { timer = undefined; void flush().catch(() => {}); },delay);
    },
    flush,
    hasPending: () => Boolean(latest || running),
  };
}
