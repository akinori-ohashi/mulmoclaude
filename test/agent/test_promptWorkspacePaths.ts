import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { promptWorkspacePaths } from "../../server/agent/promptWorkspacePaths.js";
import { CONTAINER_WORKSPACE_PATH } from "../../server/agent/containerPaths.js";

const HOST = "/Users/someone/mulmoclaude";

describe("promptWorkspacePaths", () => {
  it("under Docker the agent sees the container mount but the host path stays the real one", () => {
    assert.deepEqual(promptWorkspacePaths(HOST, true), { agentWorkspacePath: CONTAINER_WORKSPACE_PATH, hostWorkspacePath: HOST });
  });

  it("without Docker both are the host path", () => {
    assert.deepEqual(promptWorkspacePaths(HOST, false), { agentWorkspacePath: HOST, hostWorkspacePath: HOST });
  });

  it("never hands the container path out as the host path", () => {
    [true, false].forEach((useDocker) => {
      assert.notEqual(promptWorkspacePaths(HOST, useDocker).hostWorkspacePath, CONTAINER_WORKSPACE_PATH);
    });
  });
});
