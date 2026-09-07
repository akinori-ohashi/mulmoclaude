// The wait `yarn dev` performs between "backend spawned" and "start Vite".
//
// It replaces a flat `setTimeout(2000)`, which was a guess that Windows
// routinely lost: a cold `tsx` boot there takes longer, Vite came up first,
// and the page it served was broken in two ways at once (#2975) — every
// `/api` call became a body-less 502 from the proxy, and the auth token the
// dev plugin injects into index.html was read before the server had written
// it, so the tab stayed 401 until a manual reload.
//
// Waiting on the PORT (rather than on a clock, or on `/api/health`) is what
// makes both go away together: `server/index.ts` awaits
// `generateAndWriteToken` before `app.listen`, in one linear async IIFE, so
// "the port accepts a connection" already implies "the token file is on
// disk and current". A health request would prove the same thing and need
// the very credential we are racing.
//
// Everything time- and socket-shaped is injected so the policy is testable
// without either.

export interface WaitForPortOptions {
  port: number;
  /** Give up after this long and let the caller proceed anyway. */
  timeoutMs: number;
  /** Gap between probes. The first probe fires immediately. */
  pollIntervalMs: number;
  /** Resolves true once something accepts a connection on `port`. */
  probe: (port: number) => Promise<boolean>;
  /** Monotonic-enough clock. `Date.now` in production. */
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
  /** Called at most once per `noticeEveryMs` while still waiting, so a slow
   *  boot reads as progress rather than as a hang. */
  onWaiting?: (elapsedMs: number) => void;
  noticeEveryMs?: number;
}

export interface WaitForPortResult {
  ready: boolean;
  waitedMs: number;
  probes: number;
}

/**
 * Probe `port` until something accepts, or until `timeoutMs` elapses.
 *
 * Never throws and never rejects: a timeout is a result, not a failure,
 * because the caller's fallback (start Vite regardless) is exactly the
 * behaviour that shipped before this existed. Blocking the dev server on a
 * backend that will not come up would be a worse outcome than the race.
 */
export async function waitForPort(options: WaitForPortOptions): Promise<WaitForPortResult> {
  const { port, timeoutMs, pollIntervalMs, probe, now, sleep, onWaiting, noticeEveryMs } = options;
  const startedAt = now();
  let probes = 0;
  let lastNoticeAt = startedAt;

  for (;;) {
    probes += 1;
    if (await probe(port)) {
      return { ready: true, waitedMs: now() - startedAt, probes };
    }
    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      return { ready: false, waitedMs: elapsedMs, probes };
    }
    if (onWaiting && noticeEveryMs !== undefined && now() - lastNoticeAt >= noticeEveryMs) {
      lastNoticeAt = now();
      onWaiting(elapsedMs);
    }
    // Never sleep past the deadline — a long interval would otherwise
    // overshoot the timeout the caller asked for.
    await sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
  }
}
