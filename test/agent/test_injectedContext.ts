// CLI-injected context must never become reply text (#3376).
//
// Without a pending Skill, a `user`-role text block is the CLI's own context —
// the autocompact summary, the output-limit continuation — and every consumer of
// `text` (bridge relay, live stream, jsonl, Web Push) would show it as the
// assistant's answer. The fixtures are real Claude Code 2.1.284 stream-json runs
// with the spawn flags MulmoClaude uses (system / stream_event frames dropped,
// long contents truncated, ids and paths replaced).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import nodeFs from "node:fs";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { EVENT_TYPES } from "../../src/types/events.js";
import { createStreamParser, INJECTED_TEXT, type AgentEvent, type RawStreamEvent } from "../../server/agent/stream.js";
import { classifyInjectedText } from "../../server/agent/injectedText.js";

type AgentRoutes = typeof import("../../server/api/routes/agent.js");
type ToolTrace = typeof import("../../server/workspace/tool-trace/index.js");

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const CASES = [
  { fixture: "cli-stream-autocompact.jsonl", injectedPrefix: "This session is being continued from a previous conversation" },
  { fixture: "cli-stream-output-limit.jsonl", injectedPrefix: "Output token limit hit." },
] as const;

function parseFixture(name: string): AgentEvent[] {
  const parser = createStreamParser();
  return nodeFs
    .readFileSync(path.join(FIXTURE_DIR, name), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => parser.parse(JSON.parse(line) as RawStreamEvent));
}

const messagesOfType = (events: AgentEvent[], type: string): string[] =>
  events.flatMap((event) => (event.type === type && "message" in event ? [event.message] : []));

describe("classifyInjectedText", () => {
  it("is the SKILL.md body while a Skill call is pending", () => {
    const skill = { skillName: "bigskill", toolUseId: "toolu_1" };
    assert.deepEqual(classifyInjectedText(skill), { kind: "skill-body", skill });
  });

  it("is CLI context when no Skill call is pending", () => {
    assert.deepEqual(classifyInjectedText(null), { kind: "cli-context" });
  });
});

describe("parser — CLI context arrives as injected text, never as text", () => {
  for (const { fixture, injectedPrefix } of CASES) {
    it(fixture, () => {
      const events = parseFixture(fixture);
      const injected = messagesOfType(events, INJECTED_TEXT);
      assert.ok(injected.length > 0, "fixture must contain the injection");
      assert.ok(injected.every((message) => message.startsWith(injectedPrefix)));
      assert.ok(messagesOfType(events, EVENT_TYPES.text).every((message) => !message.includes(injectedPrefix)));
    });
  }
});

describe("handleAgentEvent — CLI context stays out of the reply", () => {
  let root: string;
  let originalHome: string | undefined;
  let originalWorkspace: string | undefined;
  let routes: AgentRoutes;
  let toolTrace: ToolTrace;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mulmo-injected-context-"));
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

  async function replyTextAfter(events: AgentEvent[]): Promise<{ accumulated: string; persisted: string; assistantText: string }> {
    const chatSessionId = `injected-context-${randomUUID()}`;
    const context = {
      chatSessionId,
      resultsFilePath: path.join(root, "results.jsonl"),
      toolArgsCache: toolTrace.createArgsCache(),
      textAccumulator: [] as string[],
      pendingSkill: null,
      lastAssistantText: "",
    };
    for (const event of events) await routes.handleAgentEvent(event, context);
    const raw = await readFile(path.join(root, "conversations", "chat", `${chatSessionId}.jsonl`), "utf8").catch(() => "");
    const persisted = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { message?: string })
      .map((entry) => entry.message ?? "")
      .join("");
    return { accumulated: context.textAccumulator.join(""), persisted, assistantText: context.lastAssistantText };
  }

  for (const { fixture, injectedPrefix } of CASES) {
    it(fixture, async () => {
      const events = parseFixture(fixture);
      const ownText = messagesOfType(events, EVENT_TYPES.text).join("");
      assert.ok(ownText.length > 0, "fixture must contain the assistant's own text");
      const { accumulated, persisted, assistantText } = await replyTextAfter(events);
      for (const surface of [accumulated, persisted, assistantText]) {
        assert.ok(!surface.includes(injectedPrefix), "CLI context reaching the reply is the reported bug");
      }
      assert.equal(persisted + accumulated, ownText, "the assistant's own text is kept whole, in order");
    });
  }
});
