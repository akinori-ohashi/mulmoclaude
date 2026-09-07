import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * What a host can actually import.
 *
 * 4.1.0 shipped `SCRIPT_CHANGED_EVENT` in the bundle but did not re-export it from
 * `/server`, so the one host that needed it could not name the channel. The tarball check
 * passed because the string WAS in the archive — presence in a file is not reachability
 * through an entry point, and only the entry point is the contract.
 */

describe("entry points", () => {
  it("exposes the pubsub channel names a host has to publish on", async () => {
    const server = await import("../src/server/index");
    assert.equal(server.GENERATION_EVENT, "generation");
    assert.equal(server.SCRIPT_CHANGED_EVENT, "scriptChanged");
  });

  it("serves the browser entry the same constants, from the one place they are defined", async () => {
    // `src/vue/index.ts` cannot be imported here — it pulls in `style.css`, which node has no
    // loader for. What matters is that both entries re-export the SAME module, so assert the
    // source of truth and let the re-export lists be checked by typecheck.
    const contract = await import("../src/core/contract");
    const server = await import("../src/server/index");
    assert.equal(server.GENERATION_EVENT, contract.GENERATION_EVENT);
    assert.equal(server.SCRIPT_CHANGED_EVENT, contract.SCRIPT_CHANGED_EVENT);
  });

  it("names the channels the host builds its pubsub topic from", async () => {
    const contract = await import("../src/core/contract");
    // `plugin:mulmoScript:<event>` — a rename here silently stops every View listening.
    assert.equal(contract.GENERATION_EVENT, "generation");
    assert.equal(contract.SCRIPT_CHANGED_EVENT, "scriptChanged");
  });

  it("keeps the server's ops factory and dispatch handler reachable", async () => {
    const server = await import("../src/server/index");
    assert.equal(typeof server.createMulmoScriptServerOps, "function");
    assert.equal(typeof server.createMulmoScriptDispatchHandler, "function");
  });
});
