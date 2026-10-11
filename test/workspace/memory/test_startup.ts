import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { memoryMigrationsSettled, startMemoryMigrations } from "../../../server/workspace/memory/startup.js";

const WORKSPACE = "/workspace-under-test";

describe("startMemoryMigrations", () => {
  it("runs the runners in order with the workspace root, and settles after the last one", async () => {
    const calls: string[] = [];
    startMemoryMigrations(WORKSPACE, [
      async (root) => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        calls.push(`legacy:${root}`);
      },
      async (root) => {
        calls.push(`topic:${root}`);
      },
    ]);
    await memoryMigrationsSettled();
    assert.deepEqual(calls, [`legacy:${WORKSPACE}`, `topic:${WORKSPACE}`]);
  });

  it("settles without rejecting when a runner throws, and skips the runners after it", async () => {
    const calls: string[] = [];
    startMemoryMigrations(WORKSPACE, [
      async () => {
        throw new Error("legacy failed");
      },
      async () => {
        calls.push("topic");
      },
    ]);
    await memoryMigrationsSettled();
    assert.deepEqual(calls, []);
  });

  it("a second start waits for a chain that is still running", async () => {
    let releaseFirst: () => void = () => {};
    const firstRunning = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    startMemoryMigrations(WORKSPACE, [
      async () => {
        await firstRunning;
        calls.push("first");
      },
    ]);
    startMemoryMigrations(WORKSPACE, [
      async () => {
        calls.push("second");
      },
    ]);
    let settled = false;
    const waiting = memoryMigrationsSettled().then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    releaseFirst();
    await waiting;
    assert.deepEqual(calls, ["first", "second"]);
  });

  it("settles immediately when no runners are given", async () => {
    startMemoryMigrations(WORKSPACE, []);
    assert.equal(await memoryMigrationsSettled(), undefined);
  });
});
