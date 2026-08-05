import { spawn } from "node:child_process";
import path from "node:path";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { codexBinPath } from "../../utils/codexBin.js";
import { CODEX_INTERRUPT_TIMEOUT_MS } from "../../utils/time.js";
import { isRecord } from "../../utils/types.js";
import { discoverSkills } from "../../workspace/skills/discovery.js";
import { AGENT_SESSION_EVENT_TYPE, type AgentEvent } from "../stream.js";
import { CodexAppServerClient, type CodexProcess } from "./codex/client.js";
import { CodexEventMapper } from "./codex/eventMapper.js";
import { toCodexMcpConfig } from "./codex/mcpConfig.js";
import type { CodexUserInput } from "./codex/protocol.js";
import type { AgentInput, LLMBackend } from "./types.js";

async function* runCodexAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  if (input.abortSignal?.aborted) return;
  let proc: CodexProcess;
  try {
    proc = spawn(codexBinPath(), ["app-server"], {
      cwd: input.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
  } catch (error) {
    yield spawnError(error);
    return;
  }
  yield* runWithProcess(proc, input);
}

async function* runWithProcess(proc: CodexProcess, input: AgentInput): AsyncGenerator<AgentEvent> {
  const client = new CodexAppServerClient(proc);
  const abort = attachAbort(client, proc, input.abortSignal);
  let stderrBytes = 0;
  proc.stderr.on("data", (chunk: Buffer) => (stderrBytes += chunk.length));
  try {
    await waitForSpawn(proc);
    await initialize(client);
    const threadId = await openThread(client, input);
    yield { type: AGENT_SESSION_EVENT_TYPE, backendId: "codex", token: threadId };
    const turnId = await startTurn(client, threadId, input);
    abort.setTurn(threadId, turnId);
    yield* streamTurn(client, turnId);
  } catch (error) {
    if (!input.abortSignal?.aborted) yield setupError(error, input.sessionToken !== undefined);
  } finally {
    abort.detach();
    client.close();
    log.info("agent", "codex app-server stopped", { stderrBytes });
  }
}

function waitForSpawn(proc: CodexProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (proc.pid) {
      resolve();
    } else {
      proc.once("spawn", resolve);
      proc.once("error", reject);
    }
  });
}

async function initialize(client: CodexAppServerClient): Promise<void> {
  await client.request("initialize", {
    clientInfo: { name: "mulmoclaude", title: "MulmoClaude", version: "1" },
  });
  client.notify("initialized", {});
  await ensureAuthenticated(client);
}

async function ensureAuthenticated(client: CodexAppServerClient): Promise<void> {
  let response: unknown;
  try {
    response = await client.request("account/read", { refreshToken: false });
  } catch (error) {
    throw new Error(`Codex CLI app-server is incompatible; update @openai/codex. ${errorMessage(error)}`);
  }
  if (isRecord(response) && response.requiresOpenaiAuth === true && response.account === null) {
    throw new Error("Codex is not signed in. Run `codex login` and try again.");
  }
}

async function openThread(client: CodexAppServerClient, input: AgentInput): Promise<string> {
  const { method, params } = buildCodexThreadRequest(input);
  const response = await client.request(method, params);
  const threadId = nestedId(response, "thread");
  if (!threadId) throw new Error(`${method} returned no thread id`);
  return threadId;
}

export function buildCodexThreadRequest(input: AgentInput): { method: "thread/start" | "thread/resume"; params: Record<string, unknown> } {
  const common = threadParams(input);
  return input.sessionToken ? { method: "thread/resume", params: { threadId: input.sessionToken, ...common } } : { method: "thread/start", params: common };
}

function threadParams(input: AgentInput): Record<string, unknown> {
  const config = toCodexMcpConfig(input.mcpConfig);
  return {
    cwd: input.workspacePath,
    approvalPolicy: "never",
    sandbox: "workspace-write",
    serviceName: "mulmoclaude",
    developerInstructions: input.systemPrompt,
    ...(config ? { config } : {}),
  };
}

async function startTurn(client: CodexAppServerClient, threadId: string, input: AgentInput): Promise<string> {
  const response = await client.request("turn/start", await buildCodexTurnParams(threadId, input));
  const turnId = nestedId(response, "turn");
  if (!turnId) throw new Error("turn/start returned no turn id");
  return turnId;
}

export async function buildCodexTurnParams(threadId: string, input: AgentInput): Promise<Record<string, unknown>> {
  return {
    threadId,
    input: await buildCodexInput(input),
    cwd: input.workspacePath,
    approvalPolicy: "never",
    sandboxPolicy: { type: "workspaceWrite", writableRoots: [input.workspacePath], networkAccess: true },
    ...(input.effortLevel ? { effort: input.effortLevel === "max" ? "xhigh" : input.effortLevel } : {}),
  };
}

export async function buildCodexInput(input: AgentInput): Promise<CodexUserInput[]> {
  const skill = await resolveInvokedSkill(input.message, input.workspacePath);
  const text = skill ? input.message.replace(/^(\s*)\//, "$1$") : input.message;
  const items: CodexUserInput[] = [{ type: "text", text }];
  if (skill) items.push({ type: "skill", name: skill.name, path: skill.path });
  for (const attachment of input.attachments ?? []) {
    if (!attachment.mimeType?.startsWith("image/") || !attachment.path) continue;
    items.push({ type: "localImage", path: path.resolve(input.workspacePath, attachment.path) });
  }
  return items;
}

async function resolveInvokedSkill(message: string, workspacePath: string): Promise<{ name: string; path: string } | null> {
  const name = message.trim().match(/^\/([a-z0-9][a-z0-9-]*)(?:\s|$)/i)?.[1];
  if (!name) return null;
  const skills = await discoverSkills({ workspaceRoot: workspacePath });
  const skill = skills.find((candidate) => candidate.name === name);
  return skill ? { name: skill.name, path: skill.path } : null;
}

async function* streamTurn(client: CodexAppServerClient, turnId: string): AsyncGenerator<AgentEvent> {
  const mapper = new CodexEventMapper();
  for await (const notification of client.notifications()) {
    for (const event of mapper.map(notification)) yield event;
    if (notification.method === "turn/completed" && turnIdOf(notification.params) === turnId) return;
  }
  throw new Error("codex app-server exited before turn/completed");
}

function turnIdOf(params: unknown): string | undefined {
  return nestedId(params, "turn");
}

function nestedId(value: unknown, key: "thread" | "turn"): string | undefined {
  if (!isRecord(value) || !isRecord(value[key])) return undefined;
  return typeof value[key].id === "string" ? value[key].id : undefined;
}

interface AbortHandle {
  setTurn: (threadId: string, turnId: string) => void;
  detach: () => void;
}

function attachAbort(client: CodexAppServerClient, proc: CodexProcess, signal: AbortSignal | undefined): AbortHandle {
  let activeTurn: { threadId: string; turnId: string } | undefined;
  const onAbort = () => {
    if (!activeTurn) {
      if (!proc.killed) proc.kill();
      return;
    }
    void client
      .request("turn/interrupt", activeTurn, CODEX_INTERRUPT_TIMEOUT_MS)
      .catch(() => {})
      .finally(() => {
        if (!proc.killed) proc.kill();
      });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    setTurn: (threadId, turnId) => {
      activeTurn = { threadId, turnId };
    },
    detach: () => signal?.removeEventListener("abort", onAbort),
  };
}

function spawnError(error: unknown): AgentEvent {
  return { type: EVENT_TYPES.error, message: `Failed to spawn codex: ${errorMessage(error)}` };
}

function setupError(error: unknown, wasResume: boolean): AgentEvent {
  const message = errorMessage(error);
  if (wasResume && isMissingThreadError(message)) {
    return { type: EVENT_TYPES.error, message, recovery: "stale-session" };
  }
  return { type: EVENT_TYPES.error, message };
}

function isMissingThreadError(message: string): boolean {
  return /thread.*(?:not found|missing)|rollout.*(?:not found|missing)|unknown thread/i.test(message);
}

export const codexAppServerBackend: LLMBackend = {
  id: "codex",
  capabilities: { sessionResume: true, mcp: true, sandboxOwner: "backend" },
  runAgent: runCodexAgent,
};
