// startChatWhenIdle: a turn that finds its session busy waits for the running
// agent to finish, within its own remaining time, instead of being dropped (#3320).

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "@mulmobridge/protocol";
import { startChatWhenIdle, type IdleStartDeps } from "../src/start-when-idle.ts";
import type { SessionEventListener, StartChatParams, StartChatResult } from "../src/types.ts";

const SESSION_ID = "sess-1";
const PARAMS: StartChatParams = { message: "hi", roleId: "general", chatSessionId: SESSION_ID };
const STARTED: StartChatResult = { kind: "started", chatSessionId: SESSION_ID };
const BUSY: StartChatResult = { kind: "error", error: "Session is already running", status: 409 };
const LIMIT_MS = 1_000;

interface FakeSession {
  deps: IdleStartDeps;
  startChatCalls: () => number;
  liveListeners: () => number;
  /** The running agent ends: every subscriber of the session hears sessionFinished. */
  finishRun: () => void;
}

/** `startChat` answers from `answers` in order (the last one repeats). */
function fakeSession(answers: StartChatResult[], remainingMs: () => number = () => LIMIT_MS): FakeSession {
  const listeners = new Set<SessionEventListener>();
  const calls = { startChat: 0 };
  const deps: IdleStartDeps = {
    startChat: async () => {
      const answer = answers[Math.min(calls.startChat, answers.length - 1)] ?? STARTED;
      calls.startChat += 1;
      return answer;
    },
    onSessionEvent: (_sessionId, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remainingMs,
  };
  return {
    deps,
    startChatCalls: () => calls.startChat,
    liveListeners: () => listeners.size,
    finishRun: () => [...listeners].forEach((listener) => listener({ type: EVENT_TYPES.sessionFinished })),
  };
}

async function settle(): Promise<void> {
  const ROUNDS = 10;
  for (let round = 0; round < ROUNDS; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Starts the call and records its result once it has one — never awaited, so a hang fails an assertion. */
function observe(session: FakeSession): { outcome: { result?: unknown } } {
  const outcome: { result?: unknown } = {};
  void startChatWhenIdle(session.deps, PARAMS).then((result) => {
    outcome.result = result;
  });
  return { outcome };
}

describe("startChatWhenIdle — session not busy", () => {
  it("returns the first start as-is and never subscribes", async () => {
    const session = fakeSession([STARTED]);
    assert.deepEqual(await startChatWhenIdle(session.deps, PARAMS), STARTED);
    assert.equal(session.startChatCalls(), 1);
    assert.equal(session.liveListeners(), 0);
  });

  it("passes a non-409 error straight through", async () => {
    const failure: StartChatResult = { kind: "error", error: "Invalid attachments payload", status: 400 };
    const session = fakeSession([failure]);
    assert.deepEqual(await startChatWhenIdle(session.deps, PARAMS), failure);
    assert.equal(session.startChatCalls(), 1);
  });
});

describe("startChatWhenIdle — session busy", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("waits for the running agent to finish, then starts", async () => {
    const session = fakeSession([BUSY, BUSY, STARTED]);
    const { outcome } = observe(session);
    await settle();
    assert.equal(outcome.result, undefined, "must wait while the session is busy");
    assert.equal(session.liveListeners(), 1);
    session.finishRun();
    await settle();
    assert.deepEqual(outcome.result, STARTED);
    assert.equal(session.startChatCalls(), 3);
    assert.equal(session.liveListeners(), 0);
  });

  it("does not wait when the run ended between the 409 and the subscription", async () => {
    const session = fakeSession([BUSY, STARTED]);
    const { outcome } = observe(session);
    await settle();
    assert.deepEqual(outcome.result, STARTED, "the retry after subscribing must start without waiting for an event");
    assert.equal(session.liveListeners(), 0);
  });

  it("gives up as expired when the run is still going at the message's deadline", async () => {
    const session = fakeSession([BUSY]);
    const { outcome } = observe(session);
    await settle();
    mock.timers.tick(LIMIT_MS - 1);
    await settle();
    assert.equal(outcome.result, undefined);
    mock.timers.tick(1);
    await settle();
    assert.deepEqual(outcome.result, { kind: "expired" });
    assert.equal(session.startChatCalls(), 2, "no start after the deadline");
    assert.equal(session.liveListeners(), 0);
  });

  it("is expired at once when the message has no time left", async () => {
    const session = fakeSession([BUSY], () => 0);
    assert.deepEqual(await startChatWhenIdle(session.deps, PARAMS), { kind: "expired" });
    assert.equal(session.startChatCalls(), 1);
    assert.equal(session.liveListeners(), 0);
  });

  it("unsubscribes even when the finish is reported during subscription", async () => {
    const session = fakeSession([BUSY, BUSY, STARTED]);
    const subscribe = session.deps.onSessionEvent;
    session.deps.onSessionEvent = (sessionId, listener) => {
      const unsubscribe = subscribe(sessionId, listener);
      listener({ type: EVENT_TYPES.sessionFinished });
      return unsubscribe;
    };
    assert.deepEqual(await startChatWhenIdle(session.deps, PARAMS), STARTED);
    assert.equal(session.liveListeners(), 0);
  });

  it("releases the wait when the retry itself throws", async () => {
    const session = fakeSession([BUSY]);
    const failure = new Error("startChat blew up");
    const answers = { calls: 0 };
    session.deps.startChat = async () => {
      answers.calls += 1;
      if (answers.calls === 1) return BUSY;
      throw failure;
    };
    await assert.rejects(startChatWhenIdle(session.deps, PARAMS), failure);
    assert.equal(session.liveListeners(), 0, "no listener may outlive the failed call");
  });

  it("waits again when another run took the session before the retry", async () => {
    // first try, retry after subscribing, retry after the first finish — all busy; the next one starts.
    const session = fakeSession([BUSY, BUSY, BUSY, STARTED]);
    const { outcome } = observe(session);
    await settle();
    session.finishRun();
    await settle();
    assert.equal(outcome.result, undefined, "a second run started in between, so it must keep waiting");
    session.finishRun();
    await settle();
    assert.deepEqual(outcome.result, STARTED);
    assert.equal(session.startChatCalls(), 4);
    assert.equal(session.liveListeners(), 0);
  });
});
