import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWhileTyping, startTypingIndicator, STOP_WAIT_MS, TYPING_REFRESH_MS, type TypingTimers } from "../src/typing.ts";

interface FakeTimer {
  callback: () => void;
  delay_ms: number;
  cancelled: boolean;
}

function fakeTimers(): TypingTimers & { repeating: FakeTimer[]; oneShots: FakeTimer[]; fireRepeating: () => void } {
  const repeating: FakeTimer[] = [];
  const oneShots: FakeTimer[] = [];
  const register = (list: FakeTimer[]) => (callback: () => void, delay_ms: number) => {
    const timer = { callback, delay_ms, cancelled: false };
    list.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const fireRepeating = (): void => {
    repeating.filter((timer) => !timer.cancelled).forEach((timer) => timer.callback());
  };
  return { every: register(repeating), after: register(oneShots), repeating, oneShots, fireRepeating };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A sendTyping whose every call stays pending until the test settles it. */
function controlledSender(): { send: () => Promise<void>; calls: Deferred[] } {
  const calls: Deferred[] = [];
  const send = (): Promise<void> => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };
  return { send, calls };
}

function nth<T>(list: T[], index: number): T {
  const item = list[index];
  if (item === undefined) assert.fail(`expected an entry at index ${index}, have ${list.length}`);
  return item;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function recordingLog(): { warn: (message: string) => void; warnings: string[] } {
  const warnings: string[] = [];
  return { warn: (message) => warnings.push(message), warnings };
}

describe("startTypingIndicator", () => {
  it("sends once immediately and refreshes on the default cadence", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const typing = startTypingIndicator(sender.send, { log: recordingLog(), timers });
    assert.equal(sender.calls.length, 1);
    assert.equal(nth(timers.repeating, 0).delay_ms, TYPING_REFRESH_MS);

    nth(sender.calls, 0).resolve();
    await flush();
    timers.fireRepeating();
    assert.equal(sender.calls.length, 2);

    nth(sender.calls, 1).resolve();
    await typing.stop();
  });

  it("skips a refresh while the previous send is still in flight", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const typing = startTypingIndicator(sender.send, { log: recordingLog(), timers });
    timers.fireRepeating();
    timers.fireRepeating();
    assert.equal(sender.calls.length, 1);

    nth(sender.calls, 0).resolve();
    await flush();
    timers.fireRepeating();
    assert.equal(sender.calls.length, 2);

    nth(sender.calls, 1).resolve();
    await typing.stop();
  });

  it("never sends after stop()", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const typing = startTypingIndicator(sender.send, { log: recordingLog(), timers });
    nth(sender.calls, 0).resolve();
    await typing.stop();

    assert.equal(nth(timers.repeating, 0).cancelled, true);
    nth(timers.repeating, 0).callback();
    assert.equal(sender.calls.length, 1);
  });

  it("stop() waits for the in-flight send before resolving", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const typing = startTypingIndicator(sender.send, { log: recordingLog(), timers });

    const state = { stopped: false };
    const stopping = typing.stop().then(() => {
      state.stopped = true;
    });
    await flush();
    assert.equal(state.stopped, false);

    nth(sender.calls, 0).resolve();
    await stopping;
    assert.equal(state.stopped, true);
    assert.equal(nth(timers.oneShots, 0).cancelled, true);
  });

  it("stop() gives up on a hung send after the wait cap", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const typing = startTypingIndicator(sender.send, { log: recordingLog(), timers });

    const stopping = typing.stop();
    await flush();
    assert.equal(nth(timers.oneShots, 0).delay_ms, STOP_WAIT_MS);
    nth(timers.oneShots, 0).callback();
    await stopping;
  });

  it("stop() resolves at once when nothing is in flight", async () => {
    const timers = fakeTimers();
    const typing = startTypingIndicator(async () => {}, { log: recordingLog(), timers });
    await flush();
    await typing.stop();
    assert.equal(timers.oneShots.length, 0);
  });

  it("logs a failed send and keeps refreshing", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const log = recordingLog();
    const typing = startTypingIndicator(sender.send, { log, timers });

    nth(sender.calls, 0).reject(new Error("Missing Permissions"));
    await flush();
    assert.equal(log.warnings.length, 1);
    assert.match(nth(log.warnings, 0), /Missing Permissions/);

    timers.fireRepeating();
    assert.equal(sender.calls.length, 2);
    nth(sender.calls, 1).resolve();
    await typing.stop();
  });

  it("stop() twice is harmless", async () => {
    const timers = fakeTimers();
    const typing = startTypingIndicator(async () => {}, { log: recordingLog(), timers });
    await typing.stop();
    await typing.stop();
    timers.fireRepeating();
    assert.equal(timers.repeating.length, 1);
  });

  it("honours custom refresh and wait values", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const typing = startTypingIndicator(sender.send, { log: recordingLog(), timers, refreshMs: 50, stopWaitMs: 7 });
    assert.equal(nth(timers.repeating, 0).delay_ms, 50);
    const stopping = typing.stop();
    await flush();
    assert.equal(nth(timers.oneShots, 0).delay_ms, 7);
    nth(timers.oneShots, 0).callback();
    await stopping;
  });
});

describe("runWhileTyping", () => {
  it("returns the work's result with the indicator already down", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const work = deferred();
    const running = runWhileTyping(
      sender.send,
      async () => {
        await work.promise;
        return "reply";
      },
      { log: recordingLog(), timers },
    );

    work.resolve();
    await flush();
    const state = { done: false };
    const finished = running.then((result) => {
      state.done = true;
      return result;
    });
    await flush();
    assert.equal(state.done, false, "must wait for the in-flight typing send");

    nth(sender.calls, 0).resolve();
    assert.equal(await finished, "reply");
    assert.equal(nth(timers.repeating, 0).cancelled, true);
  });

  it("stops the indicator when the work throws", async () => {
    const timers = fakeTimers();
    const sender = controlledSender();
    const running = runWhileTyping(sender.send, () => Promise.reject(new Error("relay failed")), { log: recordingLog(), timers });
    nth(sender.calls, 0).resolve();
    await assert.rejects(running, /relay failed/);
    assert.equal(nth(timers.repeating, 0).cancelled, true);
    nth(timers.repeating, 0).callback();
    assert.equal(sender.calls.length, 1);
  });
});
