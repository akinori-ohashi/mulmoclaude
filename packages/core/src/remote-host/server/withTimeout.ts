const ONE_SECOND_MS = 1_000;

/** Reject once `timeoutMs` has passed, so a stalled read answers instead of hanging. */
export const withTimeout = async <T>(work: Promise<T>, timeoutMs: number, what = "presence read"): Promise<T> => {
  const timer: { handle: ReturnType<typeof setTimeout> | null } = { handle: null };
  const deadline = new Promise<never>((_, reject) => {
    timer.handle = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(timeoutMs / ONE_SECOND_MS)}s`)), timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer.handle) clearTimeout(timer.handle);
  }
};
