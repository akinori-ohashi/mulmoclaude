// Keeps a platform's "working on it" indicator (Discord typing, LINE loading,
// Telegram chat action) up while a bridge waits for the agent's reply.

// A hung indicator request must never hold the reply back.
export const INDICATOR_STOP_WAIT_MS = 2_000;

export type SendIndicator = () => Promise<unknown>;
type Cancel = () => void;

export interface IndicatorTimers {
  every: (callback: () => void, delay_ms: number) => Cancel;
  after: (callback: () => void, delay_ms: number) => Cancel;
}

export interface ProcessingIndicatorOptions {
  /** Shorter than the platform keeps the indicator up after one request. */
  refreshMs: number;
  /** Log prefix, e.g. the transport id. */
  label: string;
  log: { warn: (message: string) => void };
  timers?: IndicatorTimers;
  stopWaitMs?: number;
}

export interface ProcessingIndicator {
  /** Resolves once no indicator request is in flight, or after the wait cap. */
  stop: () => Promise<void>;
}

const nodeTimers: IndicatorTimers = {
  every: (callback, delay_ms) => {
    const handle = setInterval(callback, delay_ms);
    return () => clearInterval(handle);
  },
  after: (callback, delay_ms) => {
    const handle = setTimeout(callback, delay_ms);
    return () => clearTimeout(handle);
  },
};

export function startProcessingIndicator(sendIndicator: SendIndicator, options: ProcessingIndicatorOptions): ProcessingIndicator {
  const timers = options.timers ?? nodeTimers;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || inFlight) return;
    inFlight = sendIndicatorSafely(sendIndicator, options).finally(() => {
      inFlight = null;
    });
  };

  tick();
  const cancelRefresh = timers.every(tick, options.refreshMs);

  const stop = async (): Promise<void> => {
    stopped = true;
    cancelRefresh();
    if (inFlight) await waitAtMost(inFlight, options.stopWaitMs ?? INDICATOR_STOP_WAIT_MS, timers);
  };
  return { stop };
}

/** Runs `work` with the indicator up; it is fully down by the time this resolves or rejects. */
export async function runWithProcessingIndicator<T>(sendIndicator: SendIndicator, work: () => Promise<T>, options: ProcessingIndicatorOptions): Promise<T> {
  const indicator = startProcessingIndicator(sendIndicator, options);
  try {
    return await work();
  } finally {
    await indicator.stop();
  }
}

/** Posts only once the indicator is fully down: a request that crosses the post lands after it and puts the indicator back on an answered message. */
export async function replyAfterProcessingIndicator<T>(
  sendIndicator: SendIndicator,
  steps: { produce: () => Promise<T>; post: (reply: T) => Promise<unknown> },
  options: ProcessingIndicatorOptions,
): Promise<void> {
  const reply = await runWithProcessingIndicator(sendIndicator, steps.produce, options);
  await steps.post(reply);
}

async function sendIndicatorSafely(sendIndicator: SendIndicator, options: ProcessingIndicatorOptions): Promise<void> {
  try {
    await sendIndicator();
  } catch (err) {
    options.log.warn(`[${options.label}] processing indicator request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function waitAtMost(pending: Promise<void>, limit_ms: number, timers: IndicatorTimers): Promise<void> {
  let cancelGiveUp: Cancel = () => {};
  const giveUp = new Promise<void>((resolve) => {
    cancelGiveUp = timers.after(resolve, limit_ms);
  });
  await Promise.race([pending, giveUp]);
  cancelGiveUp();
}
