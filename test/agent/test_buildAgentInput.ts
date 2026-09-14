import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Role } from "../../src/config/roles.js";
import type { ChatModel } from "../../src/config/models.js";
import type { LLMBackend } from "../../server/agent/backend/index.js";

// #3104, raised by Codex in round 2 of the cross-review.
//
// The per-role model is assembled from three pieces that are each tested on
// their own: `resolveChatModel` is pure and covered, `RoleSchema` narrowing the
// stored alias is covered, and `buildCliArgs` turning `AgentInput.chatModel`
// into `--model` is covered. What NOTHING covered is the join — the one line in
// `buildAgentInput` that decides to consult `role.model` at all.
//
// That gap was measured, not assumed: reverting that line to `settings.chatModel`
// left the whole suite green — 10,169 pass, the only failure an unrelated port
// collision. The entire feature could be disconnected and every test would agree
// it was fine. These cases fail when that happens.
//
// The module is imported AFTER HOME/workspace are redirected, because
// `buildAgentInput` calls `loadSettings()` which resolves the workspace at call
// time from the environment.

type ConfigModule = typeof import("../../server/system/config.js");
type AgentModule = typeof import("../../server/agent/index.js");

let root: string;
let originalHome: string | undefined;
let originalWorkspace: string | undefined;
let agent: AgentModule;
let config: ConfigModule;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mulmo-build-agent-input-"));
  originalHome = process.env.HOME;
  originalWorkspace = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  process.env.HOME = root;
  process.env.MULMOCLAUDE_WORKSPACE_PATH = root;
  await mkdir(path.join(root, "config"), { recursive: true });
  config = await import("../../server/system/config.js");
  agent = await import("../../server/agent/index.js");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  else process.env.MULMOCLAUDE_WORKSPACE_PATH = originalWorkspace;
  await rm(root, { recursive: true, force: true });
});

const setGlobalModel = async (chatModel: ChatModel | undefined): Promise<void> => {
  const settings = chatModel ? { extraAllowedTools: [], chatModel } : { extraAllowedTools: [] };
  await writeFile(path.join(root, "config", "settings.json"), JSON.stringify(settings));
};

const roleWith = (model: ChatModel | undefined): Role => ({
  id: "r",
  name: "R",
  icon: "person",
  prompt: "p",
  availablePlugins: [],
  ...(model ? { model } : {}),
});

const chatModelFor = (role: Role): ChatModel | undefined =>
  agent.buildAgentInput(
    { message: "m", role, workspacePath: root, sessionId: "s", port: 0 },
    { activePlugins: [], useDocker: false, userServers: {}, backend: { id: "codex" } as LLMBackend },
    {
      systemPrompt: "sp",
      hasMcp: false,
      mcpPaths: { hostPath: path.join(root, "mcp.json"), argPath: path.join(root, "mcp.json") },
      mcpServerNames: [],
      broker: null,
      spawnId: "spawn",
      startMarkerPath: path.join(root, "marker"),
    },
  ).agentInput.chatModel;

describe("buildAgentInput — chatModel wiring", () => {
  it("uses the ROLE's model when it has one", async () => {
    await setGlobalModel("opus");
    assert.equal(chatModelFor(roleWith("haiku")), "haiku");
  });

  it("falls back to the app-wide setting when the role has none", async () => {
    await setGlobalModel("opus");
    assert.equal(chatModelFor(roleWith(undefined)), "opus");
  });

  // Neither decides → no `--model` at all, so the CLI resolves from
  // ~/.claude/settings.json. Undefined here is what makes that happen.
  it("passes nothing when neither the role nor the setting decides", async () => {
    await setGlobalModel(undefined);
    assert.equal(chatModelFor(roleWith(undefined)), undefined);
  });

  // The precedence, stated as the thing a revert would break: the role wins
  // even though a perfectly valid app-wide setting is present.
  it("prefers the role over a set app-wide model, not the other way round", async () => {
    await setGlobalModel("sonnet");
    assert.notEqual(chatModelFor(roleWith("haiku")), "sonnet");
    assert.equal(chatModelFor(roleWith("haiku")), "haiku");
  });

  it("uses the role's model even with no app-wide setting", async () => {
    await setGlobalModel(undefined);
    assert.equal(chatModelFor(roleWith("fable")), "fable");
  });

  // Built-in roles carry no model, so they take the app-wide value with no
  // special case anywhere in the resolver.
  it("gives a model-less role exactly what a built-in role would get", async () => {
    await setGlobalModel("opus");
    assert.equal(chatModelFor(roleWith(undefined)), config.loadSettings().chatModel);
  });
});
