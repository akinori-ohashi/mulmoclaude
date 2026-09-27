// Unit tests for the dev backend supervisor's restart policy
// (`scripts/dev-server.mjs`). The script itself is JS; we import the pure
// helpers (no spawn, no process.argv reading) and drive them directly.
//
// Why this matters: before the supervisor, one backend crash mid-session
// turned every client request into `ECONNREFUSED` and `concurrently -k`
// then killed the whole `yarn dev`. The policy below is what makes that a
// blip — while still failing loudly when the backend simply can't boot.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crashHint, describeExit, recentCrashTimes, restartPlan, tooManyRecentCrashes } from "../../scripts/dev-server.mjs";
import { EXIT_CODE_NEEDS_USER_ACTION } from "../../server/utils/exit-codes.mjs";

describe("restartPlan", () => {
  it("restarts briskly after a backend that ran a while", () => {
    const plan = restartPlan({ ranForMs: 60_000, prevDelayMs: 4000, fastCrashes: 3 });
    assert.equal(plan.action, "restart");
    assert.equal(plan.delayMs, 300);
    // A long-lived run clears the crash-loop counter — this was a one-off.
    assert.equal(plan.fastCrashes, 0);
  });

  it("backs off exponentially while crashes keep coming fast", () => {
    const first = restartPlan({ ranForMs: 100, prevDelayMs: 0, fastCrashes: 0 });
    assert.deepEqual(first, { action: "restart", delayMs: 300, fastCrashes: 1 });
    const second = restartPlan({ ranForMs: 100, prevDelayMs: first.delayMs, fastCrashes: first.fastCrashes });
    assert.deepEqual(second, { action: "restart", delayMs: 600, fastCrashes: 2 });
    const third = restartPlan({ ranForMs: 100, prevDelayMs: second.delayMs, fastCrashes: second.fastCrashes });
    assert.deepEqual(third, { action: "restart", delayMs: 1200, fastCrashes: 3 });
  });

  it("caps the backoff", () => {
    const plan = restartPlan({ ranForMs: 100, prevDelayMs: 4000, fastCrashes: 1 });
    assert.equal(plan.delayMs, 5000);
  });

  // A backend that can never boot must fail loudly rather than respawn
  // forever behind a wall of identical stack traces.
  it("gives up after five consecutive fast crashes", () => {
    const plan = restartPlan({ ranForMs: 100, prevDelayMs: 5000, fastCrashes: 4 });
    assert.equal(plan.action, "giveup");
    assert.equal(plan.fastCrashes, 5);
  });
});

describe("restartPlan — backend asks for user action", () => {
  // A credentials failure takes ~33 s per cycle, long enough to reset the
  // fast-crash counter, and each cycle can spend a billed Claude session.
  it("does not restart, even after a long run", () => {
    const plan = restartPlan({ ranForMs: 33_000, prevDelayMs: 300, fastCrashes: 0, exitCode: EXIT_CODE_NEEDS_USER_ACTION });
    assert.equal(plan.action, "needs-user");
  });

  it("does not restart after a fast exit either", () => {
    const plan = restartPlan({ ranForMs: 100, prevDelayMs: 0, fastCrashes: 0, exitCode: EXIT_CODE_NEEDS_USER_ACTION });
    assert.equal(plan.action, "needs-user");
  });

  it("keeps restarting on an ordinary crash code", () => {
    assert.equal(restartPlan({ ranForMs: 33_000, prevDelayMs: 300, fastCrashes: 0, exitCode: 1 }).action, "restart");
    assert.equal(restartPlan({ ranForMs: 33_000, prevDelayMs: 300, fastCrashes: 0, exitCode: null }).action, "restart");
  });

  // 1 is the generic crash code the supervisor must keep restarting on.
  it("uses a code distinct from a generic crash", () => {
    assert.notEqual(EXIT_CODE_NEEDS_USER_ACTION, 1);
    assert.notEqual(EXIT_CODE_NEEDS_USER_ACTION, 0);
  });
});

describe("recentCrashTimes / tooManyRecentCrashes", () => {
  const ONE_MINUTE_MS = 60_000;
  const NOW_MS = 100 * ONE_MINUTE_MS;

  function crashesEvery(intervalMs: number, count: number): number[] {
    return Array.from({ length: count }, (_, index) => NOW_MS - (count - index) * intervalMs);
  }

  it("adds the current crash and keeps those inside the window", () => {
    assert.deepEqual(recentCrashTimes([NOW_MS - 11 * ONE_MINUTE_MS, NOW_MS - ONE_MINUTE_MS], NOW_MS), [NOW_MS - ONE_MINUTE_MS, NOW_MS]);
  });

  it("drops a crash exactly one window old", () => {
    assert.deepEqual(recentCrashTimes([NOW_MS - 10 * ONE_MINUTE_MS], NOW_MS), [NOW_MS]);
  });

  // #3309: a backend that died about 33 s in, every time, was restarted for days.
  it("stops a loop of slow crashes that the fast-crash counter never sees", () => {
    const recent = recentCrashTimes(crashesEvery(33_000, 9), NOW_MS);
    assert.equal(tooManyRecentCrashes(recent), true);
  });

  it("keeps restarting a backend that crashes now and then", () => {
    const recent = recentCrashTimes(crashesEvery(5 * ONE_MINUTE_MS, 9), NOW_MS);
    assert.equal(tooManyRecentCrashes(recent), false);
  });

  it("allows one fewer crash than the limit inside the window", () => {
    assert.equal(tooManyRecentCrashes(recentCrashTimes(crashesEvery(33_000, 8), NOW_MS)), false);
  });
});

describe("describeExit", () => {
  it("names the signal when the child was killed", () => {
    assert.equal(describeExit(null, "SIGKILL"), "signal SIGKILL");
  });

  it("falls back to the exit code", () => {
    assert.equal(describeExit(1, null), "code 1");
  });
});

describe("crashHint", () => {
  // Every dev crash captured so far is a V8 heap OOM, which reaches us as a
  // bare SIGABRT with no JS stack — the hint is the only breadcrumb.
  it("calls out a heap OOM on SIGABRT", () => {
    assert.match(crashHint("SIGABRT"), /heap OOM/);
  });

  it("stays quiet for exits that explain themselves", () => {
    assert.equal(crashHint("SIGTERM"), "");
    assert.equal(crashHint(null), "");
  });
});
