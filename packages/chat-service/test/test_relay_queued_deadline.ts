// A queued turn's reply limit counts from when the relay received it (#3312).
// The bridge client starts its ack timer at send time, so a limit counted from
// the start of collection let a turn queued behind a long one outlive the
// client's wait, and its reply went nowhere.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "@mulmobridge/protocol";
import { createRelay } from "../src/relay.ts";
import type { RelayDeps, RelayResult } from "../src/relay.ts";
import type { ChatStateStore, TransportChatState } from "../src/chat-state.ts";
import type { Logger, OnSessionEventFn, SessionEventListener } from "../src/types.ts";

const silentLogger: Logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function makeStore(stateReadDelayMs: number): ChatStateStore {
  const state: TransportChatState = {
    externalChatId: "chat-1",
    sessionId: "sess-1",
    roleId: "general",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    getChatState: async () => {
      await new Promise((resolve) => setTimeout(resolve, stateReadDelayMs));
      return state;
    },
    setChatState: async () => {},
    resetChatState: async () => state,
    connectSession: async () => null,
    generateSessionId: () => "sess-gen",
  };
}

interface Harness {
  send: (replyTimeoutMs: number, text?: string) => Promise<RelayResult>;
  startChatCalls: () => number;
  /** Ends every agent turn still subscribed, so no limit timer outlives the test. */
  finishAll: () => void;
}

const COMMAND_REPLY = "command handled";

/** Each agent turn streams "turn-<n>" and then finishes after `finishAfterMs[n]`, or never.
 *  A message whose text is "/cmd" is a command that answers without reaching the agent. */
function makeHarness(finishAfterMs: (number | undefined)[], stateReadDelayMs = 0): Harness {
  const listeners: SessionEventListener[] = [];
  const calls = { startChat: 0 };
  const onSessionEvent: OnSessionEventFn = (_sessionId, listener) => {
    const turn = listeners.length;
    listeners.push(listener);
    setTimeout(() => listener({ type: EVENT_TYPES.text, message: `turn-${turn}` }), 1);
    const finishMs = finishAfterMs[turn];
    if (finishMs !== undefined) setTimeout(() => listener({ type: EVENT_TYPES.sessionFinished }), finishMs);
    return () => {};
  };
  const deps: RelayDeps = {
    store: makeStore(stateReadDelayMs),
    handleCommand: async (text) => (text === "/cmd" ? { reply: COMMAND_REPLY } : null),
    startChat: async () => {
      calls.startChat += 1;
      return { kind: "started", chatSessionId: "sess-1" };
    },
    onSessionEvent,
    getRole: (id) => ({ id, name: id }),
    defaultRoleId: "general",
    logger: silentLogger,
  };
  const relayMessage = createRelay(deps);
  return {
    send: (replyTimeoutMs, text = "hi") =>
      relayMessage({ transportId: "test", externalChatId: "chat-1", text, bridgeOptions: { replyTimeoutMs: String(replyTimeoutMs) } }),
    startChatCalls: () => calls.startChat,
    finishAll: () => listeners.forEach((listener) => listener({ type: EVENT_TYPES.sessionFinished })),
  };
}

async function timed(turn: Promise<RelayResult>): Promise<{ result: RelayResult; elapsedMs: number }> {
  const startedAt = Date.now();
  const result = await turn;
  return { result, elapsedMs: Date.now() - startedAt };
}

describe("relay — a queued turn's limit counts from receipt", () => {
  it("a turn queued behind a finishing one gets only what is left of its limit", async () => {
    const LIMIT_MS = 400;
    const FIRST_TURN_MS = 300;
    // Counted from the start of collection, the second turn would run until FIRST_TURN_MS + LIMIT_MS.
    const COUNTED_FROM_COLLECTION_MS = FIRST_TURN_MS + LIMIT_MS;
    const harness = makeHarness([FIRST_TURN_MS, undefined]);
    try {
      const first = harness.send(LIMIT_MS);
      const second = timed(harness.send(LIMIT_MS));
      assert.deepEqual(await first, { kind: "ok", reply: "turn-0" });
      const { result, elapsedMs } = await second;
      assert.deepEqual(result, { kind: "ok", reply: "turn-1" });
      assert.ok(elapsedMs < (LIMIT_MS + COUNTED_FROM_COLLECTION_MS) / 2, `second turn settled after ${elapsedMs} ms`);
      assert.equal(harness.startChatCalls(), 2);
    } finally {
      harness.finishAll();
    }
  });

  it("a turn whose limit ran out while queued is answered without starting the agent", async () => {
    const FIRST_LIMIT_MS = 200;
    const SECOND_LIMIT_MS = 100;
    const harness = makeHarness([undefined, undefined]);
    try {
      const first = harness.send(FIRST_LIMIT_MS);
      const second = harness.send(SECOND_LIMIT_MS);
      assert.deepEqual(await first, { kind: "ok", reply: "turn-0" });
      const secondResult = await second;
      assert.equal(secondResult.kind, "ok");
      assert.match(secondResult.kind === "ok" ? secondResult.reply : "", /timed out before the agent could start/);
      assert.equal(harness.startChatCalls(), 1, "the expired turn must not reach the agent");
    } finally {
      harness.finishAll();
    }
  });

  it("a limit used up before the agent starts — here by a slow state read — does not start it", async () => {
    const LIMIT_MS = 50;
    const STATE_READ_MS = 120;
    const harness = makeHarness([undefined], STATE_READ_MS);
    try {
      const result = await harness.send(LIMIT_MS);
      assert.match(result.kind === "ok" ? result.reply : "", /timed out before the agent could start/);
      assert.equal(harness.startChatCalls(), 0);
    } finally {
      harness.finishAll();
    }
  });

  it("a command whose limit ran out while queued still runs — it answers without the agent", async () => {
    const FIRST_LIMIT_MS = 200;
    const SECOND_LIMIT_MS = 100;
    const harness = makeHarness([undefined]);
    try {
      const first = harness.send(FIRST_LIMIT_MS);
      const second = harness.send(SECOND_LIMIT_MS, "/cmd");
      await first;
      assert.deepEqual(await second, { kind: "ok", reply: COMMAND_REPLY });
      assert.equal(harness.startChatCalls(), 1);
    } finally {
      harness.finishAll();
    }
  });
});
