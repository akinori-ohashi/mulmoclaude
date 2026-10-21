// One streamed reply: chunks accumulate here and a timer mirrors them into a
// single Telegram message (sent once, then edited). Created per request so a
// failed request cannot leave its timer or text behind for the next one.

import type { TelegramApi } from "./api.js";

interface StreamLog {
  error: (msg: string) => void;
}

export interface ReplyStream {
  append(chunk: string): void;
  /** Stops the timer, sends what is pending, and resolves to the id of the
   *  streamed message — or null when nothing was streamed. */
  finish(): Promise<number | null>;
  /** Stops the timer without sending anything more. Safe to call twice. */
  stop(): void;
}

interface StreamState {
  accumulated: string;
  dirty: boolean;
  messageId: number | null;
  // Flushes run one after another, so a slow first sendMessage has settled
  // before the next flush decides between sending and editing.
  flushChain: Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
}

export function createReplyStream(api: TelegramApi, chatId: number, log: StreamLog, interval_ms: number): ReplyStream {
  const state: StreamState = { accumulated: "", dirty: false, messageId: null, flushChain: Promise.resolve(), timer: null };

  async function sendOrEdit(text: string): Promise<void> {
    if (state.messageId === null) {
      state.messageId = await api.sendMessage(chatId, text);
      return;
    }
    await api.editMessageText(chatId, state.messageId, text);
  }

  async function flushPending(): Promise<void> {
    if (!state.dirty) return;
    state.dirty = false;
    const action = state.messageId === null ? "sendMessage" : "editMessage";
    try {
      await sendOrEdit(state.accumulated || "…");
    } catch (err) {
      log.error(`[telegram] stream ${action} failed: ${String(err)}`);
    }
  }

  function flush(): Promise<void> {
    state.flushChain = state.flushChain.then(flushPending);
    return state.flushChain;
  }

  function stop(): void {
    if (state.timer === null) return;
    clearInterval(state.timer);
    state.timer = null;
  }

  state.timer = setInterval(() => void flush(), interval_ms);

  return {
    append(chunk) {
      if (state.timer === null) return;
      state.accumulated += chunk;
      state.dirty = true;
    },
    async finish() {
      stop();
      await flush();
      return state.messageId;
    },
    stop,
  };
}
