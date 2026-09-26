import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { makeSharedRun } from "../../server/utils/sharedRun.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: Error) => void } {
  let resolve: (value: T) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("makeSharedRun", () => {
  it("runs the task once for concurrent calls and hands every caller its value", async () => {
    const gate = deferred<boolean>();
    let starts = 0;
    const shared = makeSharedRun(() => {
      starts += 1;
      return gate.promise;
    });
    const calls = [shared(), shared(), shared()];
    gate.resolve(true);
    assert.deepEqual(await Promise.all(calls), [true, true, true]);
    assert.equal(starts, 1);
  });

  it("starts a new run once the previous one has settled", async () => {
    let starts = 0;
    const shared = makeSharedRun(async () => {
      starts += 1;
      return starts;
    });
    assert.equal(await shared(), 1);
    assert.equal(await shared(), 2);
  });

  it("shares a rejection with every joiner, then lets the next call retry", async () => {
    const gate = deferred<string>();
    let starts = 0;
    const shared = makeSharedRun(() => {
      starts += 1;
      return starts === 1 ? gate.promise : Promise.resolve("second");
    });
    const calls = [shared(), shared()];
    gate.reject(new Error("boom"));
    const results = await Promise.allSettled(calls);
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.equal(await shared(), "second");
    assert.equal(starts, 2);
  });
});
