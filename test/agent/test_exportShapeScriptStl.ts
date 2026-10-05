// The host side of `exportShapeScriptStl`: the export reaches storage through the
// same artifacts adapter as the USDZ export, so a printable model lands under
// `<workspace>/artifacts/shapes/` as a binary STL, and the tool is offered with
// the package's contract rather than a local copy of it.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeExportShapeScriptStl, EXPORT_STL_TOOL_NAME, EXPORT_STL_TOOL_TIMEOUT_MS, SHAPE_EXTENSIONS } from "@gui-chat-plugin/shapescript";
import { makeArtifactsShapeFiles } from "../../server/agent/mcp-tools/exportShapeScriptUsdz.js";
import { exportShapeScriptStl } from "../../server/agent/mcp-tools/exportShapeScriptStl.js";
import { makeByPathFileOps } from "../../server/utils/files/by-path.js";

// Two overlapping cubes and no union: the export merges them into one solid.
const TWO_CUBES = "cube\ncube {\n position 0.5 0 0\n}";

/** Triangles a binary STL declares; its size must agree: 84 + 50 per triangle. */
function stlTriangles(bytes: Buffer): number {
  const triangles = bytes.readUInt32LE(80);
  assert.equal(bytes.length, 84 + 50 * triangles);
  return triangles;
}

describe("exportShapeScriptStl", () => {
  let tmp: string;
  let workspace: string;

  before(async () => {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), "mulmo-stl-")));
    workspace = path.join(tmp, "workspace");
    await mkdir(workspace);
  });

  after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("is offered with the package's contract and outlasts the export's budget", () => {
    assert.equal(exportShapeScriptStl.definition.name, EXPORT_STL_TOOL_NAME);
    assert.equal(exportShapeScriptStl.bridgeTimeoutMs, EXPORT_STL_TOOL_TIMEOUT_MS);
    assert.match(exportShapeScriptStl.definition.description, /STL/);
  });

  it("writes one merged solid under artifacts/shapes/ with the printability report", async () => {
    const files = { artifacts: makeArtifactsShapeFiles(() => workspace), byPath: makeByPathFileOps(SHAPE_EXTENSIONS) };
    const { message, bytes } = await executeExportShapeScriptStl({ files }, { script: TWO_CUBES, title: "Two Cubes", unitScale: 10 });
    const written = (await readdir(path.join(workspace, "artifacts", "shapes"))).filter((name) => name.endsWith(".stl"));
    assert.equal(written.length, 1);
    const [name] = written;
    assert.ok(name);
    assert.match(name, /^two-cubes-.*\.stl$/);
    const stl = await readFile(path.join(workspace, "artifacts", "shapes", name));
    assert.equal(stl.length, bytes);
    assert.ok(stlTriangles(stl) > 0);
    assert.match(message, /Size 15 x 10 x 10 mm, 1 body/);
    assert.match(message, /2 part\(s\) merged, 0 skipped; 0 non-manifold edges\./);
  });
});
