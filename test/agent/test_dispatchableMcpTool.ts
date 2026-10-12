import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDispatchableMcpTool } from "../../server/agent/dispatchableMcpTool.ts";

const registry = [{ definition: { name: "spawnBackgroundChat" } }, { definition: { name: "notify" } }, { definition: { name: "handlePermission" } }];

describe("findDispatchableMcpTool", () => {
  it("returns a registered tool that is published", () => {
    assert.equal(findDispatchableMcpTool("notify", registry, new Set(["notify", "handlePermission"])), registry[1]);
    assert.equal(findDispatchableMcpTool("handlePermission", registry, new Set(["handlePermission"])), registry[2]);
  });

  it("refuses a registered tool the role does not publish", () => {
    assert.equal(findDispatchableMcpTool("spawnBackgroundChat", registry, new Set(["notify", "handlePermission"])), undefined);
    assert.equal(findDispatchableMcpTool("notify", registry, new Set()), undefined);
  });

  it("refuses a published name that is not a pure MCP tool (a GUI plugin dispatches elsewhere)", () => {
    assert.equal(findDispatchableMcpTool("presentDocument", registry, new Set(["presentDocument"])), undefined);
  });

  it("refuses names that are neither registered nor published", () => {
    for (const name of ["", "constructor", "__proto__", "toString", "NOTIFY", " notify"]) {
      assert.equal(findDispatchableMcpTool(name, registry, new Set(["notify"])), undefined, JSON.stringify(name));
    }
  });
});
