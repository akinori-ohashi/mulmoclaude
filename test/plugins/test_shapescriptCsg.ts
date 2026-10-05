// Boot switches ShapeScript's CSG to manifold: after `enableShapeScriptManifold()`
// every conversion that names no engine uses manifold, and nothing is warned.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csgEngineFor } from "@gui-chat-plugin/shapescript";
import { enableShapeScriptManifold } from "../../server/plugins/shapescript-csg.js";

describe("enableShapeScriptManifold", () => {
  it("makes manifold the default engine", async () => {
    const warnings: string[] = [];
    await enableShapeScriptManifold((message) => warnings.push(message));
    assert.deepEqual(warnings, []);
    assert.equal(csgEngineFor(), "manifold");
  });
});
