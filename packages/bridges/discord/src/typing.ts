// Keeps Discord's "typing…" indicator up while the bridge waits for a reply.

// Discord drops the indicator about 10 s after each send.
export const TYPING_REFRESH_MS = 8_000;
// A hung typing request must never hold the reply back.
export const STOP_WAIT_MS = 2_000;

export type SendTyping = () => Promise<unknown>;
type Cancel = () => void;

export interface TypingTimers {
  every: (callback: () => void, delay_ms: number) => Cancel;
  after: (callback: () => void, delay_ms: number) => Cancel;
}

export interface TypingIndicatorOptions {
  log: { warn: (message: string) => void };
  timers?: TypingTimers;
  refreshMs?: number;
  stopWaitMs?: number;
}

export interface TypingIndicator {
  /** Resolves once no typing request is in flight, or after the wait cap. */
  stop: () => Promise<void>;
}

const nodeTimers: TypingTimers = {
  every: (callback, delay_ms) => {
    const handle = setInterval(callback, delay_ms);
    return () => clearInterval(handle);
  },
  after: (callback, delay_ms) => {
    const handle = setTimeout(callback, delay_ms);
    return () => clearTimeout(handle);
  },
};

export function startTypingIndicator(sendTyping: SendTyping, options: TypingIndicatorOptions): TypingIndicator {
  const timers = options.timers ?? nodeTimers;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || inFlight) return;
    inFlight = sendTypingSafely(sendTyping, options.log).finally(() => {
      inFlight = null;
    });
  };

  tick();
  const cancelRefresh = timers.every(tick, options.refreshMs ?? TYPING_REFRESH_MS);

  const stop = async (): Promise<void> => {
    stopped = true;
    cancelRefresh();
    if (inFlight) await waitAtMost(inFlight, options.stopWaitMs ?? STOP_WAIT_MS, timers);
  };
  return { stop };
}

/** Runs `work` with the indicator up; it is fully down by the time this resolves or rejects. */
export async function runWhileTyping<T>(sendTyping: SendTyping, work: () => Promise<T>, options: TypingIndicatorOptions): Promise<T> {
  const typing = startTypingIndicator(sendTyping, options);
  try {
    return await work();
  } finally {
    await typing.stop();
  }
}

/** Posts only once the indicator is fully down: a typing request that crosses the post lands after it and leaves "typing…" up on an answered message. */
export async function replyAfterTyping<T>(
  sendTyping: SendTyping,
  steps: { produce: () => Promise<T>; post: (reply: T) => Promise<unknown> },
  options: TypingIndicatorOptions,
): Promise<void> {
  const reply = await runWhileTyping(sendTyping, steps.produce, options);
  await steps.post(reply);
}

async function sendTypingSafely(sendTyping: SendTyping, log: TypingIndicatorOptions["log"]): Promise<void> {
  try {
    await sendTyping();
  } catch (err) {
    log.warn(`[discord] sendTyping failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function waitAtMost(pending: Promise<void>, limit_ms: number, timers: TypingTimers): Promise<void> {
  let cancelGiveUp: Cancel = () => {};
  const giveUp = new Promise<void>((resolve) => {
    cancelGiveUp = timers.after(resolve, limit_ms);
  });
  await Promise.race([pending, giveUp]);
  cancelGiveUp();
}
