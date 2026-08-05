// Backend factory. Today there is only ClaudeCodeBackend; future
// backends (OpenAI, Ollama native, Gemini) are selected here based on
// env / settings. Callers go through getActiveBackend() rather than
// importing a concrete adapter so adding a backend doesn't require
// touching every call site.
//
// Tests / CI swap in `fakeEchoBackend` via setActiveBackend() at
// server bootstrap; the decision is made once and read with zero
// per-call overhead by the agent orchestrator.

import { spawnSync } from "node:child_process";
import { claudeCodeBackend } from "./claude-code.js";
import { codexAppServerBackend } from "./codex-app-server.js";
import type { LLMBackend } from "./types.js";
import { loadSettings, isAgentBackendPreference, type AgentBackendId, type AgentBackendPreference } from "../../system/config.js";
import { env } from "../../system/env.js";
import { SUBPROCESS_PROBE_TIMEOUT_MS } from "../../utils/time.js";
import { claudeBinPath } from "../../utils/claudeBin.js";
import { codexBinPath } from "../../utils/codexBin.js";

export type { AgentInput, BackendCapabilities, LLMBackend } from "./types.js";

const BACKENDS: Record<AgentBackendId, LLMBackend> = {
  "claude-code": claudeCodeBackend,
  codex: codexAppServerBackend,
};

let activeBackendOverride: LLMBackend | undefined;

/** Replace the active backend. Intended for server-bootstrap wiring
 *  (e.g. CI sets `MULMOCLAUDE_FAKE_AGENT=1`, the boot script then
 *  passes `fakeEchoBackend` here). Not safe to call mid-flight — the
 *  in-flight agent generators have already captured the previous
 *  backend reference, and swapping under them would race. */
export function setActiveBackend(backend: LLMBackend): void {
  activeBackendOverride = backend;
}

export function getActiveBackend(): LLMBackend {
  if (activeBackendOverride) return activeBackendOverride;
  return BACKENDS[resolveBackendPreference(configuredPreference())];
}

export function configuredPreference(): AgentBackendPreference {
  if (isAgentBackendPreference(env.agentBackend)) return env.agentBackend;
  return loadSettings().agentBackend ?? "codex";
}

export function resolveBackendPreference(
  preference: AgentBackendPreference,
  available: (backendId: AgentBackendId) => boolean = isBackendExecutable,
): AgentBackendId {
  if (preference !== "auto") return preference;
  if (available("claude-code")) return "claude-code";
  if (available("codex")) return "codex";
  return "claude-code";
}

export function isBackendExecutable(backendId: AgentBackendId): boolean {
  try {
    const binary = backendId === "claude-code" ? claudeBinPath() : codexBinPath();
    const result = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: SUBPROCESS_PROBE_TIMEOUT_MS });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}
