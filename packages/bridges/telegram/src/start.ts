// The Telegram bridge as a LIBRARY (#3080): everything the CLI used to do
// inline, minus the two things a host cannot tolerate — reading `process.env`
// and calling `process.exit`.
//
// Configuration arrives as arguments and failures arrive as thrown errors, so
// the same code serves `yarn telegram` (which reads env and exits) and the
// server's in-process registry (which logs and keeps running).

import type { BridgeClient } from "@mulmobridge/client";
import { createTelegramApi, type TelegramApi } from "./api.js";
import { parseAllowlist, type Allowlist } from "./allowlist.js";
import { createMessageRouter, type MessageRouter } from "./router.js";

export const TELEGRAM_TRANSPORT_ID = "telegram";
const DEFAULT_POLL_TIMEOUT_SEC = 25;

/** Console-compatible shape, matching `RouterDeps["log"]`. */
export interface BridgeLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface TelegramStartOptions {
  botToken: string;
  allowlist: Allowlist;
  /** Long-poll timeout handed to `getUpdates`. */
  pollTimeoutSec: number;
  /** Supplied by the caller so the CLI can pass a socket client and the server
   *  an in-process one. */
  client: BridgeClient;
  log?: BridgeLog;
}

export interface BridgeHandle {
  /** Stops polling and releases the client. Idempotent. */
  close: () => void;
  /** Resolves when the poll loop has stopped. The CLI awaits it; a host that
   *  starts many bridges attaches a rejection handler instead. */
  done: Promise<void>;
}

/** The env this bridge needs, read from an explicit bag rather than
 *  `process.env` and THROWING rather than exiting, so the server can start it
 *  in-process (#3080) while the CLI keeps its own exit codes. */
export function readTelegramEnv(env: Record<string, string | undefined>): Omit<TelegramStartOptions, "client" | "log"> {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken || botToken.trim().length === 0) {
    throw new Error("TELEGRAM_BOT_TOKEN is required. See docs/message_apps/telegram/.");
  }
  const allowlist = parseAllowlist(env.TELEGRAM_ALLOWED_CHAT_IDS);
  const pollTimeoutSec = Number(env.TELEGRAM_POLL_TIMEOUT_SEC ?? String(DEFAULT_POLL_TIMEOUT_SEC));
  if (!Number.isInteger(pollTimeoutSec) || pollTimeoutSec < 0) {
    throw new Error("TELEGRAM_POLL_TIMEOUT_SEC must be a non-negative integer");
  }
  return { botToken, allowlist, pollTimeoutSec };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const POLL_ERROR_BACKOFF_MS = 1000;

async function pollLoop(api: TelegramApi, router: MessageRouter, opts: { pollTimeoutSec: number; abortSignal: AbortSignal; log: BridgeLog }): Promise<void> {
  let offset: number | undefined;
  while (!opts.abortSignal.aborted) {
    let updates;
    try {
      updates = await api.getUpdates({ offset, timeoutSec: opts.pollTimeoutSec, signal: opts.abortSignal });
    } catch (err) {
      if (opts.abortSignal.aborted) return;
      opts.log.error(`[telegram] getUpdates error: ${String(err)}`);
      // Back off briefly so a broken network doesn't busy-loop.
      await delay(POLL_ERROR_BACKOFF_MS);
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      if (update.message) {
        await router.handleMessage(update.message);
      }
    }
  }
}

export function startTelegramBridge(opts: TelegramStartOptions): BridgeHandle {
  const log = opts.log ?? console;
  const api = createTelegramApi({ botToken: opts.botToken });
  const router = createMessageRouter({
    api,
    allowlist: opts.allowlist,
    sendToMulmo: (chatId, text, attachments) => opts.client.send(chatId, text, attachments),
  });

  // Server → Telegram streaming text chunks (Phase C of #268).
  opts.client.onTextChunk((chunk) => {
    router.handleTextChunk(chunk);
  });

  // Server → Telegram async push (Phase B of #268).
  opts.client.onPush((event) => {
    router.handlePush(event).catch((err) => log.error(`[telegram] handlePush failed: ${String(err)}`));
  });

  const abortController = new AbortController();
  let closed = false;
  const done = pollLoop(api, router, { pollTimeoutSec: opts.pollTimeoutSec, abortSignal: abortController.signal, log });

  return {
    close() {
      if (closed) return;
      closed = true;
      abortController.abort();
      opts.client.close();
    },
    done,
  };
}
