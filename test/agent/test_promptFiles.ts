// MulmoClaude's side of the plugin prompt split: the files land under the
// workspace, and the path the agent is told — resolved from the workspace,
// which is the agent's cwd natively and in Docker — opens them. A plugin
// without a split, or whose files were not written, keeps its full prompt.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Role } from "../../src/config/roles.ts";
import { getActiveToolDescriptors } from "../../server/agent/activeTools.ts";
import { agentPromptFilesDir, syncHostPromptFiles } from "../../server/agent/promptFiles.ts";
import { BUILT_IN_PROMPT_FILE_SOURCES } from "../../server/agent/plugin-names.ts";
import { BUILT_IN_SERVER_BINDINGS } from "../../src/plugins/server.ts";
import { mcpTools, MCP_TOOL_PROMPT_FILE_SOURCES } from "../../server/agent/mcp-tools/index.ts";
import { manageCollection } from "../../server/agent/mcp-tools/manageCollection.ts";
import { readPromptSplit } from "@mulmoclaude/core/prompt-files";
import { isRecord } from "../../server/utils/types.ts";
import { TOOL_DEFINITION as MULMOSCRIPT_DEFINITION } from "@mulmoclaude/mulmoscript-plugin";
import { buildPluginPromptSections } from "../../server/agent/prompt.ts";
import { registerRuntimePlugins, _resetRuntimeRegistryForTest } from "../../server/plugins/runtime-registry.ts";
import type { RuntimePlugin } from "../../server/plugins/runtime-loader.ts";

const PACKAGE = "@example/split-plugin";
const TOOL = "presentSplitThing";

const splitDefinition = {
  type: "function" as const,
  name: TOOL,
  description: "split tool",
  prompt: "FULL PROMPT TEXT",
  promptCompact: "Use it for things. Read {{promptFilesDir}}/guide.md before the first call.",
  promptFiles: { "guide.md": "# Full guide", "examples/one.md": "example" },
  parameters: { type: "object" as const, properties: {}, required: [] },
};

const runtimePlugin = (definition: RuntimePlugin["definition"]): RuntimePlugin => ({
  name: PACKAGE,
  version: "1.0.0",
  cachePath: "/tmp/cache/split/1.0.0",
  definition,
  execute: () => null,
  oauthCallbackAlias: null,
});

const role: Role = { id: "test", name: "Test", icon: "star", prompt: "", availablePlugins: [TOOL] };

const promptOf = (): string | undefined => getActiveToolDescriptors(role).find((descriptor) => descriptor.name === TOOL)?.prompt;

let workspace: string;
beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "prompt-files-host-"));
  _resetRuntimeRegistryForTest();
  syncHostPromptFiles([], workspace);
});
afterEach(() => {
  _resetRuntimeRegistryForTest();
  syncHostPromptFiles([], workspace);
  rmSync(workspace, { recursive: true, force: true });
});

describe("plugin prompt files in MulmoClaude", () => {
  it("tells the agent a workspace-relative path that opens the written file", () => {
    syncHostPromptFiles([{ packageName: PACKAGE, definition: splitDefinition }], workspace);
    const agentDir = agentPromptFilesDir(PACKAGE);
    assert.equal(agentDir, "config/helps/plugins/@example/split-plugin");
    // The agent's cwd is the workspace: resolve exactly as it would.
    const agentDirFromCwd = path.resolve(workspace, agentDir ?? "");
    assert.equal(readFileSync(path.join(agentDirFromCwd, "guide.md"), "utf-8"), "# Full guide");
    assert.equal(readFileSync(path.join(agentDirFromCwd, "examples", "one.md"), "utf-8"), "example");
  });

  it("injects the compact prompt, with the path, for a runtime plugin whose files were written", () => {
    registerRuntimePlugins(new Set(), [runtimePlugin(splitDefinition)]);
    syncHostPromptFiles([{ packageName: PACKAGE, definition: splitDefinition }], workspace);
    assert.equal(promptOf(), "Use it for things. Read config/helps/plugins/@example/split-plugin/guide.md before the first call.");
    const section = buildPluginPromptSections(role).join("\n");
    assert.ok(section.includes("config/helps/plugins/@example/split-plugin/guide.md"));
    assert.equal(section.includes("FULL PROMPT TEXT"), false);
  });

  it("falls back to the full prompt when a written file is deleted after startup", () => {
    registerRuntimePlugins(new Set(), [runtimePlugin(splitDefinition)]);
    syncHostPromptFiles([{ packageName: PACKAGE, definition: splitDefinition }], workspace);
    assert.match(promptOf() ?? "", /config\/helps\/plugins/);
    rmSync(path.join(workspace, "config", "helps", "plugins", "@example", "split-plugin", "guide.md"));
    assert.equal(promptOf(), "FULL PROMPT TEXT");
  });

  it("keeps the full prompt when the files were not written", () => {
    registerRuntimePlugins(new Set(), [runtimePlugin(splitDefinition)]);
    assert.equal(promptOf(), "FULL PROMPT TEXT");
  });

  it("keeps the full prompt when the write failed", () => {
    registerRuntimePlugins(new Set(), [runtimePlugin(splitDefinition)]);
    syncHostPromptFiles([{ packageName: PACKAGE, definition: { ...splitDefinition, promptFiles: { "../escape.md": "x" } } }], workspace);
    assert.equal(agentPromptFilesDir(PACKAGE), null);
    assert.equal(promptOf(), "FULL PROMPT TEXT");
  });

  it("leaves a plugin without a split exactly as before", () => {
    const plain = {
      type: splitDefinition.type,
      name: TOOL,
      description: splitDefinition.description,
      prompt: splitDefinition.prompt,
      parameters: splitDefinition.parameters,
    };
    registerRuntimePlugins(new Set(), [runtimePlugin(plain)]);
    syncHostPromptFiles([{ packageName: PACKAGE, definition: plain }], workspace);
    assert.equal(agentPromptFilesDir(PACKAGE), null);
    assert.equal(promptOf(), "FULL PROMPT TEXT");
  });

  it("a built-in plugin's split reaches the system prompt, and the file it names holds the full reference", () => {
    syncHostPromptFiles(BUILT_IN_PROMPT_FILE_SOURCES, workspace);
    const mulmoRole: Role = { id: "test", name: "Test", icon: "star", prompt: "", availablePlugins: ["presentMulmoScript"] };
    const section = buildPluginPromptSections(mulmoRole).join("\n");
    const toldPath = "config/helps/plugins/@mulmoclaude/mulmoscript-plugin/presentMulmoScript.md";
    assert.ok(section.includes(toldPath));
    assert.equal(section.includes(MULMOSCRIPT_DEFINITION.description), false);
    const toldFile = readFileSync(path.resolve(workspace, toldPath), "utf-8");
    assert.equal(toldFile, MULMOSCRIPT_DEFINITION.promptFiles["presentMulmoScript.md"]);
    // The description is every prompt file joined, this one first.
    assert.ok(toldFile.length > 0 && MULMOSCRIPT_DEFINITION.description.startsWith(toldFile));
  });

  it("every built-in that declares a split gets its compact text injected and every file it names on disk", () => {
    syncHostPromptFiles(BUILT_IN_PROMPT_FILE_SOURCES, workspace);
    assert.ok(BUILT_IN_PROMPT_FILE_SOURCES.length > 0);
    for (const { packageName, definition } of BUILT_IN_PROMPT_FILE_SOURCES) {
      const split = readPromptSplit(definition);
      assert.ok(split, packageName);
      const agentDir = agentPromptFilesDir(packageName);
      assert.ok(agentDir, packageName);
      for (const [name, content] of Object.entries(split.files)) {
        assert.equal(readFileSync(path.resolve(workspace, agentDir, name), "utf-8"), content, `${packageName}/${name}`);
      }
      const toolName = isRecord(definition) && typeof definition.name === "string" ? definition.name : "";
      const builtInRole: Role = { id: "test", name: "Test", icon: "star", prompt: "", availablePlugins: [toolName] };
      assert.ok(buildPluginPromptSections(builtInRole).join("\n").includes(agentDir), packageName);
    }
  });

  it("every built-in binding whose definition declares a split names its package (or the split is silently ignored)", () => {
    const missing = BUILT_IN_SERVER_BINDINGS.filter((binding) => readPromptSplit(binding.def) && !binding.packageName).map((binding) => binding.def.name);
    assert.deepEqual(missing, []);
  });

  it("every MCP tool that declares a split names its package (or the split is silently ignored)", () => {
    const missing = mcpTools.filter((tool) => readPromptSplit(tool) && !tool.packageName).map((tool) => tool.definition.name);
    assert.deepEqual(missing, []);
  });

  it("manageCollection's compact text reaches every role's prompt, with its file on disk at the told path", () => {
    syncHostPromptFiles(MCP_TOOL_PROMPT_FILE_SOURCES, workspace);
    const toldPath = "config/helps/plugins/@mulmoclaude/core/manageCollection.md";
    const anyRole: Role = { id: "test", name: "Test", icon: "star", prompt: "", availablePlugins: [] };
    const section = buildPluginPromptSections(anyRole).join("\n");
    assert.ok(section.includes(toldPath));
    assert.equal(section.includes(manageCollection.prompt), false);
    assert.equal(readFileSync(path.resolve(workspace, toldPath), "utf-8"), manageCollection.prompt);
  });
});
