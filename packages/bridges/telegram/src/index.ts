#!/usr/bin/env node
// Telegram bridge (issue #321) — the CLI. Polls Telegram for incoming
// messages and dispatches them through the shared message router,
// which enforces the chat-ID allowlist, forwards to MulmoClaude,
// and delivers Phase-B pushes back through sendMessage.
//
// The bridge itself lives in `./start.js` so the server can run it
// in-process (#3080). This file is the env-reading, `process.exit`-calling
// half that only a CLI wants.
//
// Env surface (see docs/message_apps/telegram/README.md):
//   TELEGRAM_BOT_TOKEN          — BotFather token (required)
//   TELEGRAM_ALLOWED_CHAT_IDS   — CSV of integer chat IDs (required
//                                 in practice; empty = deny everyone)
//   MULMOCLAUDE_API_URL         — optional override
//   MULMOCLAUDE_AUTH_TOKEN      — optional override
//   TELEGRAM_POLL_TIMEOUT_SEC   — optional, default 25

import "dotenv/config";
import { createBridgeClient, installProcessGuards } from "@mulmobridge/client";
import { readTelegramEnv, startTelegramBridge, TELEGRAM_TRANSPORT_ID as TRANSPORT_ID } from "./start.js";

async function main(): Promise<void> {
  // `readTelegramEnv` throws; the CLI turns that into the same message and exit
  // code it printed when the reading lived here.
  let config;
  try {
    config = readTelegramEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const { botToken, allowlist, pollTimeoutSec } = config;

  console.log("MulmoClaude Telegram bridge");
  console.log(`Allowlist: ${allowlist.size() > 0 ? allowlist.snapshot().join(", ") : "(empty — all chats will be denied)"}`);

  // Guards BEFORE the bridge starts. Splitting the bridge into a library moved
  // the poll loop's start from `await pollLoop(...)` to inside
  // `startTelegramBridge`, which would otherwise leave a window where the loop
  // is running and a signal is still unhandled. The holder is what lets the
  // shutdown callback reach a handle that does not exist yet.
  const started: { handle: { close: () => void } | null } = { handle: null };
  installProcessGuards({
    name: TRANSPORT_ID,
    onShutdown: () => {
      started.handle?.close();
    },
  });

  const handle = startTelegramBridge({
    botToken,
    allowlist,
    pollTimeoutSec,
    client: createBridgeClient({ transportId: TRANSPORT_ID }),
  });
  started.handle = handle;

  await handle.done;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
