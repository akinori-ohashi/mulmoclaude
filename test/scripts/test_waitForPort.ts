// Unit tests for `yarn dev`'s backend-readiness wait (#2975).
//
// The wait replaced a flat 2-second `setTimeout`, which Windows lost often
// enough that the first page load hit a body-less 502 from the Vite proxy AND
// an auth token that had not been written yet. Everything time- and
// socket-shaped is injected, so these run with neither: a fake clock advances
// only when `sleep` is called, which makes "did it respect the deadline?" an
// exact assertion rather than a timing-sensitive one.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { waitForPort, type WaitForPortOptions } from "../../scripts/lib/waitForPort.js";

const PORT = 3001;

/** A clock that only moves when the code under test sleeps. */
function fakeClock(): { now: () => number; sleep: (delayMs: number) => Promise<void>; slept: number[] } {
  let current = 0;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: (delayMs: number) => {
      slept.push(delayMs);
      current += delayMs;
      return Promise.resolve();
    },
    slept,
  };
}

/** Refuses the first `failures` probes, then accepts. */
function probeAfter(failures: number): (port: number) => Promise<boolean> {
  let seen = 0;
  return () => {
    seen += 1;
    return Promise.resolve(seen > failures);
  };
}

function options(overrides: Partial<WaitForPortOptions> = {}): WaitForPortOptions {
  const clock = fakeClock();
  return {
    port: PORT,
    timeoutMs: 60_000,
    pollIntervalMs: 150,
    probe: () => Promise.resolve(true),
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  };
}

describe("waitForPort", () => {
  it("returns immediately when the backend is already listening", async () => {
    const result = await waitForPort(options());
    assert.equal(result.ready, true);
    assert.equal(result.probes, 1);
    assert.equal(result.waitedMs, 0);
  });

  it("keeps probing until the port accepts", async () => {
    const result = await waitForPort(options({ probe: probeAfter(4) }));
    assert.equal(result.ready, true);
    assert.equal(result.probes, 5);
    // Four gaps between five probes.
    assert.equal(result.waitedMs, 4 * 150);
  });

  it("gives up at the deadline instead of waiting forever", async () => {
    const result = await waitForPort(options({ probe: () => Promise.resolve(false), timeoutMs: 1000 }));
    assert.equal(result.ready, false);
    // Reported, not exceeded: the caller starts Vite on this, so overshooting
    // would hold the dev server past the budget it was given.
    assert.equal(result.waitedMs, 1000);
  });

  it("never sleeps past the deadline", async () => {
    const clock = fakeClock();
    await waitForPort(
      options({
        probe: () => Promise.resolve(false),
        timeoutMs: 400,
        pollIntervalMs: 150,
        now: clock.now,
        sleep: clock.sleep,
      }),
    );
    // 150 + 150 + 100 — the last gap is clipped to what the budget had left.
    assert.deepEqual(clock.slept, [150, 150, 100]);
  });

  it("a zero timeout probes once and reports not-ready", async () => {
    const result = await waitForPort(options({ probe: () => Promise.resolve(false), timeoutMs: 0 }));
    assert.equal(result.ready, false);
    assert.equal(result.probes, 1);
  });

  it("reports progress at most once per notice interval", async () => {
    const notices: number[] = [];
    const result = await waitForPort(
      options({
        probe: probeAfter(40), // 40 * 150ms = 6s of waiting
        noticeEveryMs: 5000,
        onWaiting: (elapsedMs) => notices.push(elapsedMs),
      }),
    );
    assert.equal(result.ready, true);
    assert.deepEqual(notices, [5100]);
  });

  it("stays silent when the backend answers before the first notice is due", async () => {
    const notices: number[] = [];
    await waitForPort(
      options({
        probe: probeAfter(2),
        noticeEveryMs: 5000,
        onWaiting: (elapsedMs) => notices.push(elapsedMs),
      }),
    );
    assert.deepEqual(notices, []);
  });
});
