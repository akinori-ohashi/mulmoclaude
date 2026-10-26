// The receiver is where a page's message becomes a send or a held bar, so these drive it with
// real message-shaped events: source matching, the per-document key, the shared interval, and
// what happens when the host refuses the text.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DIRECT_SUBMIT, DIRECT_SUBMIT_MIN_INTERVAL_MS } from "../src/core/submitMode";
import { SUBMIT_MESSAGE_TYPE } from "../src/core/submitMessage";
import { SENT_NOTICE_MS, createSubmitReceiver, type DirectSubmitClock } from "../src/vue/submitReceiver";

const KEY = "doc-key";

interface Harness {
  sent: string[];
  clock: DirectSubmitClock;
  now: { ms: number };
  accept: { value: boolean };
  timers: Map<number, () => void>;
}

function setup(over: { mode?: typeof DIRECT_SUBMIT | undefined; expectedKey?: string | undefined; clock?: DirectSubmitClock; withSender?: boolean } = {}) {
  const frame = { name: "frame" };
  const state: Harness = { sent: [], clock: over.clock ?? { lastAtMs: null }, now: { ms: 10_000 }, accept: { value: true }, timers: new Map() };
  let nextTimer = 0;
  const receiver = createSubmitReceiver<number>({
    frameWindow: () => frame,
    mode: () => ("mode" in over ? over.mode : DIRECT_SUBMIT),
    expectedKey: () => ("expectedKey" in over ? over.expectedKey : KEY),
    sender:
      over.withSender === false
        ? () => undefined
        : () => (text?: string) => {
            if (!state.accept.value) return false;
            state.sent.push(text ?? "");
            return true;
          },
    nowMs: () => state.now.ms,
    clock: state.clock,
    setTimer: (callback) => {
      nextTimer += 1;
      state.timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimer: (handle) => {
      if (handle !== undefined) state.timers.delete(handle);
    },
  });
  const post = (text: string, extra: Record<string, unknown> = { key: KEY }, source: unknown = frame) =>
    receiver.onMessage({ source, data: { type: SUBMIT_MESSAGE_TYPE, text, ...extra } });
  return { receiver, state, post, frame };
}

describe("createSubmitReceiver — direct page", () => {
  it("sends a keyed message straight away and shows the sent notice", () => {
    const { receiver, state, post } = setup();
    post("Layout: B");
    assert.deepEqual(state.sent, ["Layout: B"]);
    assert.equal(receiver.submission.value, null);
    assert.equal(receiver.sentNotice.value, true);
  });

  it("holds a message without the key, or with another key, for the user to confirm", () => {
    for (const extra of [{}, { key: "other" }, { key: "" }]) {
      const { receiver, state, post } = setup();
      post("x", extra);
      assert.deepEqual(state.sent, []);
      assert.deepEqual(receiver.submission.value, { text: "x" });
    }
  });

  it("holds the second message inside the interval, and sends one after it", () => {
    const { receiver, state, post } = setup();
    post("first");
    state.now.ms += DIRECT_SUBMIT_MIN_INTERVAL_MS - 1;
    post("second");
    assert.deepEqual(state.sent, ["first"]);
    assert.deepEqual(receiver.submission.value, { text: "second" });
    state.now.ms += 1;
    post("third");
    assert.deepEqual(state.sent, ["first", "third"]);
  });

  it("shares the interval between receivers on one clock, as two cards in a tab do", () => {
    const clock: DirectSubmitClock = { lastAtMs: null };
    const a = setup({ clock });
    const b = setup({ clock });
    a.post("from a");
    b.post("from b");
    assert.deepEqual(a.state.sent, ["from a"]);
    assert.deepEqual(b.state.sent, []);
    assert.deepEqual(b.receiver.submission.value, { text: "from b" });
  });

  it("keeps the text in the bar with the failure when the host refuses it, and does not start the interval", () => {
    const { receiver, state, post } = setup();
    state.accept.value = false;
    post("Layout: B");
    assert.deepEqual(receiver.submission.value, { text: "Layout: B" });
    assert.equal(receiver.sendFailed.value, true);
    assert.equal(state.clock.lastAtMs, null);
    state.accept.value = true;
    receiver.sendHeld();
    assert.deepEqual(state.sent, ["Layout: B"]);
    assert.equal(receiver.submission.value, null);
    assert.equal(receiver.sendFailed.value, false);
  });
});

describe("createSubmitReceiver — pages that never send directly", () => {
  it("holds even a keyed message when the page has no direct mode", () => {
    const { receiver, state, post } = setup({ mode: undefined, expectedKey: undefined });
    post("x");
    assert.deepEqual(state.sent, []);
    assert.deepEqual(receiver.submission.value, { text: "x" });
  });

  it("ignores a message from any window other than this frame's", () => {
    const { receiver, state, post } = setup();
    post("x", { key: KEY }, { name: "another frame" });
    post("y", { key: KEY }, null);
    assert.deepEqual(state.sent, []);
    assert.equal(receiver.submission.value, null);
  });

  it("does nothing at all on a host without sendTextMessage", () => {
    const { receiver, post } = setup({ withSender: false });
    post("x");
    assert.equal(receiver.submission.value, null);
  });

  it("keeps a held send that the host refuses, with the failure shown", () => {
    const { receiver, state, post } = setup({ mode: undefined, expectedKey: undefined });
    post("x");
    state.accept.value = false;
    receiver.sendHeld();
    assert.deepEqual(receiver.submission.value, { text: "x" });
    assert.equal(receiver.sendFailed.value, true);
  });
});

describe("createSubmitReceiver — notice timer", () => {
  it("hides the notice after its delay and clears the timer on dispose", () => {
    const { receiver, state, post } = setup();
    post("x");
    assert.equal(state.timers.size, 1);
    const hide = [...state.timers.values()][0];
    assert.ok(hide);
    hide();
    assert.equal(receiver.sentNotice.value, false);
    state.now.ms += DIRECT_SUBMIT_MIN_INTERVAL_MS;
    post("y");
    receiver.dispose();
    assert.equal(state.timers.size, 0);
    assert.equal(typeof SENT_NOTICE_MS, "number");
  });
});
