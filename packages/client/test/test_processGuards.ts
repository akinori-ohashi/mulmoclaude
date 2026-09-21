// Tests for the bridge process guards (#3084).
//
// Each case installs the guards, emits the real process event, and asserts on
// the exit code and the message — the message is the whole point, since what a
// user had before was a stack trace naming no bridge.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { EventEmitter } from "node:events";

import { installProcessGuards, SHUTDOWN_GRACE_MS } from "../src/processGuards.ts";

const EVENTS = ["unhandledRejection", "uncaughtException", "SIGINT", "SIGTERM"] as const;
const NAME = "line";

// node:test installs its own handlers for some of these; take them out for the
// duration of a case and put them back, so a guard under test never inherits or
// clobbers them.
// Reached through the EventEmitter surface rather than `process`'s own
// overloads: those are keyed per event name, so a listener saved from a union
// of four events cannot be handed back without a cast. `process` IS an
// EventEmitter, so this is a widening, not an assertion about the value — and
// each listener only ever goes back on the event it came off.
const processEvents: EventEmitter = process;
/** Derived from node's own declaration rather than spelled out, so this file
 *  does not have to write the `any` that `EventEmitter.listeners` returns. */
type ProcessListener = ReturnType<EventEmitter["listeners"]>[number];
const saved = new Map<string, ProcessListener[]>();

beforeEach(() => {
  EVENTS.forEach((event) => {
    saved.set(event, processEvents.listeners(event));
    processEvents.removeAllListeners(event);
  });
});

afterEach(() => {
  EVENTS.forEach((event) => {
    processEvents.removeAllListeners(event);
    (saved.get(event) ?? []).forEach((listener) => processEvents.on(event, listener));
  });
  saved.clear();
});

interface Capture {
  codes: number[];
  lines: string[];
  restore: () => void;
}

const capture = (): Capture => {
  const lines: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  return {
    codes: [],
    lines,
    restore: () => {
      console.error = originalError;
      console.log = originalLog;
    },
  };
};

const withGuards = async (onShutdown: (() => void | Promise<void>) | undefined, run: (cap: Capture) => Promise<void> | void): Promise<void> => {
  const cap = capture();
  // `onShutdown: undefined` is a different type from an absent key under
  // `exactOptionalPropertyTypes`, and the option is optional, not nullable.
  installProcessGuards({ name: NAME, ...(onShutdown === undefined ? {} : { onShutdown }), exit: (code) => void cap.codes.push(code) });
  try {
    await run(cap);
  } finally {
    cap.restore();
  }
};

describe("installProcessGuards — crashes", () => {
  it("an unhandled rejection names the bridge and exits non-zero", async () => {
    await withGuards(undefined, (cap) => {
      process.emit("unhandledRejection", new Error("boom"), Promise.resolve());
      assert.deepEqual(cap.codes, [1]);
      assert.ok(
        cap.lines.some((line) => line.includes("[line] unhandled rejection — exiting: boom")),
        cap.lines.join(" | "),
      );
    });
  });

  it("a rejection with a non-Error reason does not print [object Object]", async () => {
    await withGuards(undefined, (cap) => {
      process.emit("unhandledRejection", { message: "odd" }, Promise.resolve());
      assert.deepEqual(cap.codes, [1]);
      assert.ok(
        cap.lines.some((line) => line.includes("odd")),
        cap.lines.join(" | "),
      );
      assert.ok(!cap.lines.some((line) => line.includes("[object Object]")), cap.lines.join(" | "));
    });
  });

  it("an uncaught exception exits non-zero too", async () => {
    await withGuards(undefined, (cap) => {
      process.emit("uncaughtException", new Error("thrown"), "uncaughtException");
      assert.deepEqual(cap.codes, [1]);
      assert.ok(
        cap.lines.some((line) => line.includes("[line] uncaught exception — exiting: thrown")),
        cap.lines.join(" | "),
      );
    });
  });
});

describe("installProcessGuards — signals", () => {
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it("SIGINT runs the shutdown task before exiting 0", async () => {
    let ran = 0;
    await withGuards(
      () => {
        ran++;
      },
      async (cap) => {
        process.emit("SIGINT", "SIGINT");
        await flush();
        assert.equal(ran, 1);
        assert.deepEqual(cap.codes, [0]);
        assert.ok(
          cap.lines.some((line) => line.includes("[line] SIGINT — shutting down")),
          cap.lines.join(" | "),
        );
      },
    );
  });

  it("SIGTERM is handled as well — before this only two bridges were", async () => {
    let ran = 0;
    await withGuards(
      () => {
        ran++;
      },
      async (cap) => {
        process.emit("SIGTERM", "SIGTERM");
        await flush();
        assert.equal(ran, 1);
        assert.deepEqual(cap.codes, [0]);
      },
    );
  });

  it("an async shutdown task is awaited", async () => {
    const order: string[] = [];
    await withGuards(
      async () => {
        await Promise.resolve();
        order.push("shutdown");
      },
      async (cap) => {
        process.emit("SIGINT", "SIGINT");
        await flush();
        order.push(`exit:${cap.codes.join(",")}`);
        assert.deepEqual(order, ["shutdown", "exit:0"]);
      },
    );
  });

  it("a shutdown task that throws still exits cleanly, with the failure said out loud", async () => {
    await withGuards(
      () => {
        throw new Error("close failed");
      },
      async (cap) => {
        process.emit("SIGINT", "SIGINT");
        await flush();
        assert.deepEqual(cap.codes, [0]);
        assert.ok(
          cap.lines.some((line) => line.includes("[line] shutdown task failed: close failed")),
          cap.lines.join(" | "),
        );
      },
    );
  });

  it("a second signal exits immediately instead of waiting out the grace period", async () => {
    await withGuards(
      () => new Promise<void>(() => {}), // never settles
      async (cap) => {
        process.emit("SIGINT", "SIGINT");
        await flush();
        assert.deepEqual(cap.codes, [], "the hanging task must still be pending");
        process.emit("SIGINT", "SIGINT");
        assert.deepEqual(cap.codes, [1]);
        assert.ok(
          cap.lines.some((line) => line.includes("[line] SIGINT again — exiting now")),
          cap.lines.join(" | "),
        );
      },
    );
  });

  it("the grace period is bounded, so a hanging task cannot hold the terminal", () => {
    assert.ok(SHUTDOWN_GRACE_MS > 0 && SHUTDOWN_GRACE_MS <= 30_000, `unreasonable grace: ${SHUTDOWN_GRACE_MS}`);
  });
});
