// #3288. An agent error has to reach the session JSONL, or a failed turn loses
// its explanation on reload. The live run proves it once; this pins the write
// itself — delete the append in `handleAgentEvent` and these go red.
//
// Same harness shape as `test_persistUserTurn.ts`: the route module is imported
// AFTER HOME/workspace are redirected, because session IO resolves the
// workspace from the environment at call time.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EVENT_TYPES } from "../../src/types/events.js";

type AgentRoutes = typeof import("../../server/api/routes/agent.js");
type ToolTrace = typeof import("../../server/workspace/tool-trace/index.js");

let root: string;
let originalHome: string | undefined;
let originalWorkspace: string | undefined;
let routes: AgentRoutes;
let toolTrace: ToolTrace;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mulmo-persist-agent-error-"));
  originalHome = process.env.HOME;
  originalWorkspace = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  process.env.HOME = root;
  process.env.MULMOCLAUDE_WORKSPACE_PATH = root;
  await mkdir(path.join(root, "conversations", "chat"), { recursive: true });
  routes = await import("../../server/api/routes/agent.js");
  toolTrace = await import("../../server/workspace/tool-trace/index.js");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  else process.env.MULMOCLAUDE_WORKSPACE_PATH = originalWorkspace;
  await rm(root, { recursive: true, force: true });
});

function newContext(): { chatSessionId: string; context: import("../../server/api/routes/agent.js").EventContext } {
  const chatSessionId = `persist-error-${randomUUID()}`;
  return {
    chatSessionId,
    context: {
      chatSessionId,
      resultsFilePath: path.join(root, "results.jsonl"),
      toolArgsCache: toolTrace.createArgsCache(),
      textAccumulator: [],
      pendingSkill: null,
      lastAssistantText: "",
    },
  };
}

async function sessionLines(chatSessionId: string): Promise<unknown[]> {
  const raw = await readFile(path.join(root, "conversations", "chat", `${chatSessionId}.jsonl`), "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line): unknown => JSON.parse(line));
}

describe("handleAgentEvent — error persistence", () => {
  it("writes an error event as an assistant error line", async () => {
    const { chatSessionId, context } = newContext();
    await routes.handleAgentEvent({ type: EVENT_TYPES.error, message: "claude exited with code 2" }, context);
    assert.deepEqual(await sessionLines(chatSessionId), [{ source: "assistant", type: EVENT_TYPES.error, message: "claude exited with code 2" }]);
  });

  it("flushes text streamed before the error first, so the file keeps live order", async () => {
    const { chatSessionId, context } = newContext();
    await routes.handleAgentEvent({ type: EVENT_TYPES.text, message: "partial " }, context);
    await routes.handleAgentEvent({ type: EVENT_TYPES.text, message: "reply" }, context);
    await routes.handleAgentEvent({ type: EVENT_TYPES.error, message: "boom" }, context);
    assert.deepEqual(await sessionLines(chatSessionId), [
      { source: "assistant", type: EVENT_TYPES.text, message: "partial reply" },
      { source: "assistant", type: EVENT_TYPES.error, message: "boom" },
    ]);
  });

  it("does not throw when the flush before the error fails", async () => {
    const { context } = newContext();
    context.chatSessionId = `blocked-${randomUUID()}`;
    await mkdir(path.join(root, "conversations", "chat", `${context.chatSessionId}.jsonl`), { recursive: true });
    context.textAccumulator.push("half a reply");
    await assert.doesNotReject(routes.handleAgentEvent({ type: EVENT_TYPES.error, message: "boom" }, context));
  });

  it("writes nothing for a status event — only errors get an entry", async () => {
    const { chatSessionId, context } = newContext();
    await routes.handleAgentEvent({ type: EVENT_TYPES.status, message: "Thinking..." }, context);
    assert.deepEqual(await sessionLines(chatSessionId), []);
  });
});

describe("reportRunFailure — a run that threw", () => {
  it("flushes streamed text, then persists the error", async () => {
    const { chatSessionId, context } = newContext();
    context.textAccumulator.push("half a reply");
    await routes.reportRunFailure(context, new Error("spawn failed"));
    assert.deepEqual(await sessionLines(chatSessionId), [
      { source: "assistant", type: EVENT_TYPES.text, message: "half a reply" },
      { source: "assistant", type: EVENT_TYPES.error, message: "Error: spawn failed" },
    ]);
  });

  it("still reports when the text flush itself fails, instead of throwing", async () => {
    const { context } = newContext();
    // A directory where the session file should be makes every append fail.
    context.chatSessionId = `blocked-${randomUUID()}`;
    await mkdir(path.join(root, "conversations", "chat", `${context.chatSessionId}.jsonl`), { recursive: true });
    context.textAccumulator.push("half a reply");
    await assert.doesNotReject(routes.reportRunFailure(context, new Error("spawn failed")));
  });
});
