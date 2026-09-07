// A replay re-runs a turn, so a false positive here re-executes side effects
// the user already paid for. These tests pin the two things that keep that from
// happening: only `error` events with the exact CLI phrasing classify, and a
// budget of zero refuses regardless of the message.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import {
  detectRecovery,
  isRecoverableBrokerNotReady,
  isRecoverableStaleSession,
  abortableSleep,
  awaitBrokerReady,
  judgeBrokerReplay,
} from "../../server/agent/retryPolicy.js";
import { EVENT_TYPES } from "../../src/types/events.js";

const STALE_MESSAGE = "No conversation found with session ID abc-123";
const BROKER_MESSAGE = "MCP tool mcp__mulmoclaude__handlePermission (passed via --permission-prompt-tool) not found. Available MCP tools: x";

const errorEvent = (message: unknown) => ({ type: EVENT_TYPES.error, message });

describe("isRecoverableStaleSession", () => {
  it("classifies a stale-resume error while budget remains", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(STALE_MESSAGE), 1), true);
  });

  it("accepts a provider-typed stale session without matching provider text", () => {
    assert.equal(isRecoverableStaleSession({ type: EVENT_TYPES.error, message: "thread lookup failed", recovery: "stale-session" }, 1), true);
  });

  it("refuses once the budget is exhausted", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(STALE_MESSAGE), 0), false);
  });

  it("refuses a negative budget", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(STALE_MESSAGE), -1), false);
  });

  it("refuses a non-error event carrying the same text", () => {
    assert.equal(isRecoverableStaleSession({ type: EVENT_TYPES.text, message: STALE_MESSAGE }, 1), false);
  });

  it("refuses an unrelated error message", () => {
    assert.equal(isRecoverableStaleSession(errorEvent("ENOENT: no such file or directory"), 1), false);
  });

  it("refuses an empty message", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(""), 1), false);
  });

  it("refuses a non-string message", () => {
    assert.equal(isRecoverableStaleSession(errorEvent({ text: STALE_MESSAGE }), 1), false);
    assert.equal(isRecoverableStaleSession(errorEvent(undefined), 1), false);
    assert.equal(isRecoverableStaleSession(errorEvent(null), 1), false);
  });
});

describe("isRecoverableBrokerNotReady", () => {
  it("classifies the broker startup race while budget remains", () => {
    assert.equal(isRecoverableBrokerNotReady(errorEvent(BROKER_MESSAGE), 1), true);
  });

  it("refuses once the budget is exhausted", () => {
    assert.equal(isRecoverableBrokerNotReady(errorEvent(BROKER_MESSAGE), 0), false);
  });

  // The phrase must match contiguously: a replay re-runs work, so an unrelated
  // "not found" plus a stray flag echo elsewhere in stderr must not trigger it.
  it("refuses a scattered near-match", () => {
    const scattered = "--permission-prompt-tool was passed. Later: skill 'foo' not found.";
    assert.equal(isRecoverableBrokerNotReady(errorEvent(scattered), 1), false);
  });

  it("refuses a bare not-found error", () => {
    assert.equal(isRecoverableBrokerNotReady(errorEvent("HTTP 404 not found"), 1), false);
  });

  it("refuses a non-error event carrying the same text", () => {
    assert.equal(isRecoverableBrokerNotReady({ type: EVENT_TYPES.status, message: BROKER_MESSAGE }, 1), false);
  });
});

describe("detectRecovery", () => {
  it("returns null when nothing matches", () => {
    assert.equal(detectRecovery(errorEvent("some other failure"), { stale: 3, broker: 3 }), null);
  });

  it("returns the kind that matches", () => {
    assert.equal(detectRecovery(errorEvent(STALE_MESSAGE), { stale: 1, broker: 1 }), "stale");
    assert.equal(detectRecovery(errorEvent(BROKER_MESSAGE), { stale: 1, broker: 1 }), "broker");
  });

  // Budgets are independent: the broker race hits fresh sessions too, so
  // spending the `--resume` budget must not disable broker recovery.
  it("still detects the broker race with the stale budget exhausted", () => {
    assert.equal(detectRecovery(errorEvent(BROKER_MESSAGE), { stale: 0, broker: 1 }), "broker");
  });

  it("still detects a stale session with the broker budget exhausted", () => {
    assert.equal(detectRecovery(errorEvent(STALE_MESSAGE), { stale: 1, broker: 0 }), "stale");
  });

  it("returns null when both budgets are exhausted", () => {
    assert.equal(detectRecovery(errorEvent(STALE_MESSAGE), { stale: 0, broker: 0 }), null);
    assert.equal(detectRecovery(errorEvent(BROKER_MESSAGE), { stale: 0, broker: 0 }), null);
  });
});

// The reading BEFORE the wait cannot decide this on its own: the beacon is sent
// when the broker answers `initialize`, so a broker that lost the race by a
// moment has not sent one yet at the instant the turn fails. Refusing the
// replay on that reading would break the #2057 recovery the wait exists for.
describe("judgeBrokerReplay", () => {
  it("replays when the broker had already reported ready", () => {
    assert.deepEqual(judgeBrokerReplay(true, true), { replay: true, reason: "ready-before-wait" });
  });

  // #2057: the beacon arrives DURING the wait, which is exactly the case a
  // replay fixes.
  it("replays when the beacon arrives during the wait", () => {
    assert.deepEqual(judgeBrokerReplay(false, true), { replay: true, reason: "ready-during-wait" });
  });

  // #2842: nothing ever arrived, so the replay buys a second full connect-wait
  // and ends in the same error — the 100 s the reporter measured.
  it("refuses when no beacon ever arrived", () => {
    assert.deepEqual(judgeBrokerReplay(false, false), { replay: false, reason: "never-ready" });
  });

  // Cannot happen — readiness is recorded per spawn and only a new spawn clears
  // it — but "the broker DID answer" is the safe reading if it ever does:
  // a needless replay costs latency, a refused one costs the turn.
  it("replays when readiness somehow disappears across the wait", () => {
    assert.deepEqual(judgeBrokerReplay(true, false), { replay: true, reason: "ready-before-wait" });
  });
});

// Racing against a deadline is what actually distinguishes "the abort cut the
// wait short" from "the test just awaited a 60s timer" — a bare await passes
// either way.
const PATIENCE_MS = 500;
const raceAgainstDeadline = (waited: Promise<void>): Promise<string> =>
  Promise.race([waited.then(() => "slept"), new Promise<string>((resolve) => setTimeout(() => resolve("deadline"), PATIENCE_MS))]);

describe("abortableSleep", () => {
  it("resolves after the delay when never aborted", async () => {
    assert.equal(await raceAgainstDeadline(abortableSleep(1, new AbortController().signal)), "slept");
  });

  // A stop during the pause must end it promptly rather than let a doomed
  // replay spawn after the user already cancelled.
  it("resolves immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(await raceAgainstDeadline(abortableSleep(60_000, controller.signal)), "slept");
  });

  it("resolves as soon as the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const waited = abortableSleep(60_000, controller.signal);
    controller.abort();
    assert.equal(await raceAgainstDeadline(waited), "slept");
  });

  // `{ once: true }` releases a listener only if the abort actually fires, so a
  // sleep that simply finished used to leave one behind. Harmless per call, but
  // the readiness poll calls this ~32 times on ONE signal over its window
  // (CodeRabbit review on #2931).
  it("leaves no abort listener behind when the timer wins", async () => {
    const controller = new AbortController();
    await Array.from({ length: 20 }).reduce<Promise<void>>((chain) => chain.then(() => abortableSleep(1, controller.signal)), Promise.resolve());
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

  it("leaves no abort listener behind when the abort wins", async () => {
    const controller = new AbortController();
    const waited = abortableSleep(60_000, controller.signal);
    controller.abort();
    await waited;
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});

// A beacon that is merely slow must not be read as a broker that never came up
// — that reading refuses the very replay the #2057 recovery exists for. So the
// wait ends on the beacon, not on a fixed pause (Codex review on #2931).
describe("awaitBrokerReady", () => {
  const never = new AbortController().signal;

  it("answers immediately when readiness is already there", async () => {
    const startedAt = Date.now();
    assert.equal(await awaitBrokerReady(() => "ready", 5_000, never), "ready");
    assert.ok(Date.now() - startedAt < 200, "must not wait out the window for an answer it already has");
  });

  it("answers as soon as readiness appears mid-window", async () => {
    let ready: string | null = null;
    setTimeout(() => (ready = "ready"), 300);
    const startedAt = Date.now();
    assert.equal(await awaitBrokerReady(() => ready, 60_000, never), "ready");
    assert.ok(Date.now() - startedAt < 3_000, "must not wait out the window once the beacon has landed");
  });

  it("gives up at the end of the window", async () => {
    const startedAt = Date.now();
    assert.equal(await awaitBrokerReady(() => null, 400, never), null);
    assert.ok(Date.now() - startedAt >= 400, "must not conclude before the window is spent");
  });

  // A stop must end the wait promptly rather than hold the turn open for the
  // rest of the window.
  it("gives up promptly when the turn is aborted mid-wait", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const startedAt = Date.now();
    assert.equal(await awaitBrokerReady(() => null, 60_000, controller.signal), null);
    assert.ok(Date.now() - startedAt < 3_000, "an aborted wait must not run to the deadline");
  });

  it("answers null without waiting when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const startedAt = Date.now();
    assert.equal(await awaitBrokerReady(() => null, 60_000, controller.signal), null);
    assert.ok(Date.now() - startedAt < 200);
  });

  // Readiness wins over an abort that arrived in the same moment: the broker
  // did answer, and that fact does not stop being true because the user
  // cancelled.
  it("returns readiness even when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(await awaitBrokerReady(() => "ready", 60_000, controller.signal), "ready");
  });
});
