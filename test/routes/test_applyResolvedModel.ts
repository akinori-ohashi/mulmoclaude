import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyResolvedModel } from "../../server/api/routes/agent.js";
import { EVENT_TYPES } from "../../src/types/events.js";

// #2554, raised by Codex in round 1 of the cross-review: the parser that reads
// the model out of the CLI's `system`/`init` frame was covered, but everything
// downstream of it was not. Both destinations have to fire, and losing either
// one fails SILENTLY in the opposite direction:
//
//   no persist → the chip disappears when the session is reloaded
//   no publish → the chip never appears until the session is reloaded
//
// The second of those actually happened during this PR's development: the disk
// half worked, the value was correct on disk, and nothing ever reached the
// screen. A test over the pair is what turns that into a red run.

const collect = () => {
  const persisted: [string, string][] = [];
  const published: [string, Record<string, unknown>][] = [];
  return {
    persisted,
    published,
    deps: {
      persist: async (sessionId: string, resolvedModel: string) => {
        persisted.push([sessionId, resolvedModel]);
      },
      publish: (sessionId: string, event: Record<string, unknown>) => {
        published.push([sessionId, event]);
      },
    },
  };
};

// Long enough that `publish` would win if the helper stopped awaiting the
// persist, short enough not to slow the suite.
const SLOW_PERSIST_MS = 5;

describe("applyResolvedModel", () => {
  it("writes the model to session meta", async () => {
    const { persisted, deps } = collect();
    await applyResolvedModel("s1", "claude-haiku-4-5-20251001", deps);
    assert.deepEqual(persisted, [["s1", "claude-haiku-4-5-20251001"]]);
  });

  it("publishes it live as a session_meta delta on the same session", async () => {
    const { published, deps } = collect();
    await applyResolvedModel("s1", "claude-opus-5[1m]", deps);
    assert.deepEqual(published, [["s1", { type: EVENT_TYPES.sessionMeta, resolvedModel: "claude-opus-5[1m]" }]]);
  });

  it("does BOTH for one event — neither destination may be dropped", async () => {
    const { persisted, published, deps } = collect();
    await applyResolvedModel("s1", "claude-sonnet-5", deps);
    assert.equal(persisted.length, 1, "the reload path must be written");
    assert.equal(published.length, 1, "the live path must be published");
  });

  // The publish carries the same value that was persisted, so a reload cannot
  // disagree with what the screen showed during the turn.
  it("sends the same value to both", async () => {
    const { persisted, published, deps } = collect();
    await applyResolvedModel("s1", "claude-opus-5[1m]", deps);
    assert.equal(persisted[0]?.[1], published[0]?.[1]?.resolvedModel);
  });

  it("publishes only after the persist resolves, so a reload during the turn cannot miss it", async () => {
    const order: string[] = [];
    await applyResolvedModel("s1", "claude-sonnet-5", {
      persist: async () => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_PERSIST_MS));
        order.push("persist");
      },
      publish: () => order.push("publish"),
    });
    assert.deepEqual(order, ["persist", "publish"]);
  });
});
