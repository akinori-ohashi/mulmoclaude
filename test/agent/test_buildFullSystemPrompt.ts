import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Role } from "../../src/config/roles.js";
import { CONTAINER_WORKSPACE_PATH } from "../../server/agent/containerPaths.js";

// Covers the handoff in `buildFullSystemPrompt` (#3459): both workspace paths are strings, so a swap
// there type-checks while sandbox users lose their wiki and legacy memory from the prompt.
// The module is imported after the workspace env is redirected, as in test_buildAgentInput.ts.

type AgentModule = typeof import("../../server/agent/index.js");

let root: string;
let originalHome: string | undefined;
let originalWorkspace: string | undefined;
let agent: AgentModule;

const role: Role = { id: "r", name: "R", icon: "person", prompt: "p", availablePlugins: [] };

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mulmo-full-system-prompt-"));
  originalHome = process.env.HOME;
  originalWorkspace = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  process.env.HOME = root;
  process.env.MULMOCLAUDE_WORKSPACE_PATH = root;
  await mkdir(path.join(root, "config"), { recursive: true });
  await mkdir(path.join(root, "data", "wiki"), { recursive: true });
  await writeFile(path.join(root, "data", "wiki", "index.md"), "# Index\n");
  await writeFile(path.join(root, "data", "wiki", "summary.md"), "Key topics: full-prompt handoff\n");
  await mkdir(path.join(root, "conversations"), { recursive: true });
  await writeFile(path.join(root, "conversations", "memory.md"), "# Memory\n\n- keeps a sourdough starter alive\n");
  agent = await import("../../server/agent/index.js");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  else process.env.MULMOCLAUDE_WORKSPACE_PATH = originalWorkspace;
  await rm(root, { recursive: true, force: true });
});

const promptFor = (useDocker: boolean): Promise<string> =>
  agent.buildFullSystemPrompt({ message: "m", role, workspacePath: root, sessionId: "s", port: 0 }, useDocker);

describe("buildFullSystemPrompt — workspace path handoff (#3459)", () => {
  it("under Docker shows the container path but reads the wiki and legacy memory from the host", async () => {
    const prompt = await promptFor(true);
    assert.ok(prompt.includes(`Workspace directory: ${CONTAINER_WORKSPACE_PATH}`));
    assert.ok(prompt.includes("Key topics: full-prompt handoff"));
    assert.ok(!prompt.includes("No wiki exists yet"));
    assert.ok(prompt.includes("keeps a sourdough starter alive"));
  });

  it("without Docker shows and reads the host path", async () => {
    const prompt = await promptFor(false);
    assert.ok(prompt.includes(`Workspace directory: ${root}`));
    assert.ok(prompt.includes("Key topics: full-prompt handoff"));
  });
});
