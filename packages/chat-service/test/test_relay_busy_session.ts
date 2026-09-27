// #3320 end to end through the relay: the first turn is cut off at its limit
// while its agent keeps running; the next message used to get 409 and be
// dropped with "please wait". It now waits for that run, within its own limit.

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "@mulmobridge/protocol";
import { createRelay } from "../src/relay.ts";
import type { RelayDeps, RelayResult } from "../src/relay.ts";
import type { ChatStateStore, TransportChatState } from "../src/chat-state.ts";
import type { Logger, SessionEventListener } from "../src/types.ts";

const LIMIT_MS = 500;
const silentLogger: Logger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function makeStore(): ChatStateStore {
  const state: TransportChatState = {
    externalChatId: "chat-1",
    sessionId: "sess-1",
    roleId: "general",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    getChatState: async () => state,
    setChatState: async () => {},
    resetChatState: async () => state,
    connectSession: async () => null,
    generateSessionId: () => "sess-gen",
  };
}

/** One agent session: `startChat` is refused with 409 while a run is going, like the host's `beginRun`. */
function makeSession() {
  const listeners = new Set<SessionEventListener>();
  const run = { going: false, starts: 0 };
  const emit = (event: Record<string, unknown>): void => [...listeners].forEach((listener) => listener(event));
  const deps: RelayDeps = {
    store: makeStore(),
    handleCommand: async () => null,
    startChat: async () => {
      if (run.going) return { kind: "error", error: "Session is already running", status: 409 };
      run.going = true;
      run.starts += 1;
      return { kind: "started", chatSessionId: "sess-1" };
    },
    onSessionEvent: (_sessionId, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRole: (id) => ({ id, name: id }),
    defaultRoleId: "general",
    logger: silentLogger,
    now: () => Date.now(),
  };
  const relay = createRelay(deps);
  return {
    send: (): Promise<RelayResult> => relay({ transportId: "test", externalChatId: "chat-1", text: "hi", bridgeOptions: { replyTimeoutMs: String(LIMIT_MS) } }),
    say: (text: string): void => emit({ type: EVENT_TYPES.text, message: text }),
    /** The current run ends, as the host's `endRun` reports it. */
    finishRun: (): void => {
      run.going = false;
      emit({ type: EVENT_TYPES.sessionFinished });
    },
    starts: () => run.starts,
  };
}

async function settle(): Promise<void> {
  const ROUNDS = 10;
  for (let round = 0; round < ROUNDS; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function advance(ms: number): Promise<void> {
  mock.timers.tick(ms);
  await settle();
}

/** Read through a function so an earlier `assert.equal(…, undefined)` does not narrow later reads. */
const replyOf = (outcome: { result?: RelayResult }): string => (outcome.result?.kind === "ok" ? outcome.result.reply : "");

function track(turn: Promise<RelayResult>): { outcome: { result?: RelayResult } } {
  const outcome: { result?: RelayResult } = {};
  void turn.then((result) => {
    outcome.result = result;
  });
  return { outcome };
}

describe("relay — a message arriving while a cut-off agent is still running", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  async function cutOffFirstTurn(session: ReturnType<typeof makeSession>): Promise<void> {
    const first = track(session.send());
    await settle();
    session.say("first, partial");
    await advance(LIMIT_MS);
    assert.deepEqual(first.outcome.result, { kind: "ok", reply: "first, partial" }, "the first turn is cut off; its agent keeps running");
  }

  it("waits for that run to end, then runs and answers", async () => {
    const session = makeSession();
    await cutOffFirstTurn(session);
    const second = track(session.send());
    await advance(LIMIT_MS / 2);
    assert.equal(second.outcome.result, undefined, "still waiting for the earlier run");
    assert.equal(session.starts(), 1);

    session.finishRun();
    await settle();
    assert.equal(session.starts(), 2, "started once the earlier run ended");
    session.say("second answer");
    session.finishRun();
    await settle();
    assert.deepEqual(second.outcome.result, { kind: "ok", reply: "second answer" });
  });

  it("answers 'timed out before the agent could start' if that run outlasts the message's limit", async () => {
    const session = makeSession();
    await cutOffFirstTurn(session);
    const second = track(session.send());
    await advance(LIMIT_MS - 1);
    assert.equal(second.outcome.result, undefined);
    await advance(1);
    assert.match(replyOf(second.outcome), /timed out before the agent could start/);
    assert.equal(session.starts(), 1, "never started behind the running agent");
    session.finishRun();
  });
});
