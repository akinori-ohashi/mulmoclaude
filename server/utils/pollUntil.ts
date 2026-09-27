export interface PollUntilOptions {
  /** Resolves true once the awaited state holds. Checked first without waiting. */
  check: () => Promise<boolean>;
  /** Stop early (e.g. the process being watched has exited); one last check still runs. */
  shouldStop?: () => boolean;
  timeoutMs: number;
  intervalMs: number;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
}

async function pollFrom(options: PollUntilOptions, deadlineMs: number): Promise<boolean> {
  if (await options.check()) return true;
  const remainingMs = deadlineMs - options.now();
  if (remainingMs <= 0 || options.shouldStop?.()) return false;
  await options.sleep(Math.min(options.intervalMs, remainingMs));
  return pollFrom(options, deadlineMs);
}

/** Check until `check` passes (true), the timeout elapses or `shouldStop` fires (false). Never throws on timeout. */
export function pollUntil(options: PollUntilOptions): Promise<boolean> {
  return pollFrom(options, options.now() + options.timeoutMs);
}
