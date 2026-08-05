import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EVENT_TYPES } from "../../src/types/events.js";
import { resolveBackendPreference } from "../../server/agent/backend/index.js";
import { buildCodexInput, buildCodexThreadRequest, buildCodexTurnParams } from "../../server/agent/backend/codex-app-server.js";
import { CodexEventMapper } from "../../server/agent/backend/codex/eventMapper.js";
import { toCodexMcpConfig } from "../../server/agent/backend/codex/mcpConfig.js";
import type { AgentInput } from "../../server/agent/backend/types.js";
import { ROLES } from "../../src/config/roles.js";

describe("Codex backend selection", () => {
  it("keeps Claude first in auto mode and falls back to Codex", () => {
    assert.equal(
      resolveBackendPreference("auto", () => true),
      "claude-code",
    );
    assert.equal(
      resolveBackendPreference("auto", (backendId) => backendId === "codex"),
      "codex",
    );
    assert.equal(
      resolveBackendPreference("auto", () => false),
      "claude-code",
    );
  });

  it("honours explicit selections without probing another backend", () => {
    assert.equal(
      resolveBackendPreference("claude-code", () => false),
      "claude-code",
    );
    assert.equal(
      resolveBackendPreference("codex", () => false),
      "codex",
    );
  });
});

describe("Codex event mapping", () => {
  it("streams deltas and suppresses the duplicated completed message", () => {
    const mapper = new CodexEventMapper();
    const delta = mapper.map({ method: "item/agentMessage/delta", params: { itemId: "msg-1", delta: "hello" } });
    const completed = mapper.map({ method: "item/completed", params: { item: { id: "msg-1", type: "agentMessage", text: "hello" } } });
    assert.deepEqual(delta, [{ type: EVENT_TYPES.text, message: "hello" }]);
    assert.deepEqual(completed, []);
  });

  it("maps command and MCP item lifecycles", () => {
    const mapper = new CodexEventMapper();
    const command = { id: "cmd-1", type: "commandExecution", command: "pwd", cwd: "/tmp", status: "inProgress" };
    const call = mapper.map({ method: "item/started", params: { item: command } });
    assert.deepEqual(call, [{ type: EVENT_TYPES.toolCall, toolUseId: "cmd-1", toolName: "shell_command", args: { command: "pwd", cwd: "/tmp" } }]);
    const result = mapper.map({ method: "item/completed", params: { item: { ...command, status: "completed", aggregatedOutput: "/tmp", exitCode: 0 } } });
    assert.deepEqual(result, [{ type: EVENT_TYPES.toolCallResult, toolUseId: "cmd-1", content: "/tmp" }]);
    const mcp = mapper.map({
      method: "item/started",
      params: { item: { id: "mcp-1", type: "mcpToolCall", server: "mulmoclaude", tool: "present", arguments: { x: 1 } } },
    });
    assert.equal(mcp[0]?.type, EVENT_TYPES.toolCall);
    assert.equal(mcp[0] && "toolName" in mcp[0] ? mcp[0].toolName : "", "mcp__mulmoclaude__present");
  });

  it("emits one error when error and failed completion both arrive", () => {
    const mapper = new CodexEventMapper();
    const first = mapper.map({ method: "error", params: { error: { message: "boom" } } });
    const second = mapper.map({ method: "turn/completed", params: { turn: { id: "t", status: "failed", error: { message: "boom" } } } });
    assert.deepEqual(first, [{ type: EVENT_TYPES.error, message: "boom" }]);
    assert.deepEqual(second, []);
  });
});

describe("Codex MCP config", () => {
  it("translates stdio and HTTP specs into per-thread config overrides", () => {
    const config = toCodexMcpConfig({
      mcpServers: {
        mulmoclaude: { type: "stdio", command: "node", args: ["broker.js"], env: { TOKEN: "secret" }, alwaysLoad: true },
        docs: { type: "http", url: "https://example.test/mcp", headers: { Authorization: "Bearer secret" } },
      },
    });
    assert.deepEqual(config?.["mcp_servers.mulmoclaude"], {
      command: "node",
      args: ["broker.js"],
      env: { TOKEN: "secret" },
      required: true,
      default_tools_approval_mode: "approve",
    });
    assert.deepEqual(config?.["mcp_servers.docs"], {
      url: "https://example.test/mcp",
      http_headers: { Authorization: "Bearer secret" },
      required: false,
    });
  });
});

describe("Codex turn input", () => {
  it("adds local images and resolves an exact slash skill explicitly", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "codex-input-"));
    const skillPath = path.join(workspace, ".claude", "skills", "codex-test-skill", "SKILL.md");
    mkdirSync(path.dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, "---\nname: codex-test-skill\ndescription: test\n---\nDo the test.");
    try {
      const input = await buildCodexInput(makeInput(workspace));
      assert.deepEqual(input, [
        { type: "text", text: "$codex-test-skill now" },
        { type: "skill", name: "codex-test-skill", path: skillPath },
        { type: "localImage", path: path.join(workspace, "data", "attachments", "x.png") },
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("builds start, resume, and sandboxed turn protocol payloads", async () => {
    const input = makeInput("C:\\workspace");
    input.systemPrompt = "developer instructions";
    input.message = "hello";
    input.effortLevel = "max";
    input.mcpConfig = { mcpServers: { mulmoclaude: { type: "stdio", command: "node" } } };
    const started = buildCodexThreadRequest(input);
    assert.equal(started.method, "thread/start");
    assert.equal(started.params.developerInstructions, "developer instructions");
    assert.equal(started.params.approvalPolicy, "never");
    assert.equal(started.params.sandbox, "workspace-write");
    const resumed = buildCodexThreadRequest({ ...input, sessionToken: "thr_123" });
    assert.equal(resumed.method, "thread/resume");
    assert.equal(resumed.params.threadId, "thr_123");
    const turn = await buildCodexTurnParams("thr_123", input);
    assert.equal(turn.effort, "xhigh");
    assert.deepEqual(turn.sandboxPolicy, { type: "workspaceWrite", writableRoots: ["C:\\workspace"], networkAccess: true });
  });
});

function makeInput(workspacePath: string): AgentInput {
  return {
    systemPrompt: "system",
    message: "/codex-test-skill now",
    role: ROLES[0],
    workspacePath,
    sessionId: "session",
    port: 0,
    attachments: [{ mimeType: "image/png", path: "data/attachments/x.png" }],
    activePlugins: [],
    extraAllowedTools: [],
    useDocker: false,
  };
}
