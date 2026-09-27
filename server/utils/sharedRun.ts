// Wrap `task` so a call made while it runs joins that run and receives its
// value, instead of starting a second one. No trailing re-run, unlike
// `makeSingleFlight`: joiners want the same answer, not a fresh pass.
export function makeSharedRun<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    running ??= task().finally(() => {
      running = null;
    });
    return running;
  };
}
