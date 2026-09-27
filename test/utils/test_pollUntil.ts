import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pollUntil, type PollUntilOptions } from "../../server/utils/pollUntil.js";

/** A fake clock the sleep advances, so no real timer runs. */
function fakeTimeline(): Pick<PollUntilOptions, "now" | "sleep"> & { sleeps: number[] } {
  let clockMs = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => clockMs,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      clockMs += delayMs;
    },
  };
}

describe("pollUntil", () => {
  it("resolves true at once when the state already holds", async () => {
    const timeline = fakeTimeline();
    assert.equal(await pollUntil({ ...timeline, check: async () => true, timeoutMs: 1000, intervalMs: 100 }), true);
    assert.deepEqual(timeline.sleeps, []);
  });

  it("keeps checking until the state holds", async () => {
    const timeline = fakeTimeline();
    let checks = 0;
    const check = async () => {
      checks += 1;
      return checks === 3;
    };
    assert.equal(await pollUntil({ ...timeline, check, timeoutMs: 1000, intervalMs: 100 }), true);
    assert.deepEqual(timeline.sleeps, [100, 100]);
  });

  it("gives up after the timeout without sleeping past it", async () => {
    const timeline = fakeTimeline();
    assert.equal(await pollUntil({ ...timeline, check: async () => false, timeoutMs: 250, intervalMs: 100 }), false);
    assert.deepEqual(timeline.sleeps, [100, 100, 50]);
  });

  it("stops early when told to, after one last check", async () => {
    const timeline = fakeTimeline();
    let checks = 0;
    const check = async () => {
      checks += 1;
      return false;
    };
    const result = await pollUntil({ ...timeline, check, shouldStop: () => checks >= 2, timeoutMs: 10_000, intervalMs: 100 });
    assert.equal(result, false);
    assert.equal(checks, 2);
  });

  it("still reports success found on the check that coincides with stopping", async () => {
    const timeline = fakeTimeline();
    let checks = 0;
    const check = async () => {
      checks += 1;
      return checks === 2;
    };
    assert.equal(await pollUntil({ ...timeline, check, shouldStop: () => checks >= 2, timeoutMs: 10_000, intervalMs: 100 }), true);
  });

  it("with a zero timeout checks exactly once", async () => {
    const timeline = fakeTimeline();
    let checks = 0;
    const check = async () => {
      checks += 1;
      return false;
    };
    assert.equal(await pollUntil({ ...timeline, check, timeoutMs: 0, intervalMs: 100 }), false);
    assert.equal(checks, 1);
  });
});
