// Pure dispatcher: maps an SseEvent into mutations on an ActiveSession
// via the AgentEventContext adapter. No Vue refs, no component scope.

import type { ActiveSession } from "../../types/session";
import type { SseEvent, SseToolCallResult, SseGenerationStarted, SseGenerationFinished, SseSessionMeta } from "../../types/sse";
import { EVENT_TYPES, generationKey, type PendingGeneration } from "../../types/events";
import type { ToolCallHistoryItem } from "../../types/toolCallHistory";
import { findPendingToolCall, toToolCallEntry } from "./toolCalls";
import { extractMcpHint } from "./mcpHint";
import { pushErrorMessage, applySkillEvent, applyTextEvent, applyToolResultToSession } from "../session/sessionHelpers";
import { reconcileSyntheticCollection } from "../collections/presentSeed";

export interface AgentEventContext {
  session: ActiveSession;
  refreshRoles: () => Promise<void>;
  scrollSidebarToBottom: () => void;
  onGenerationsDrained: () => void;
}

// Route a `toolCallResult` SSE event onto the pending history entry.
// Errors land on `entry.error` (drives the red chip) with an optional
// catalog-derived MCP hint; successes land on `entry.result`. Pulled
// out of `applyAgentEvent` so the dispatch switch keeps its cognitive
// complexity below the lint budget (#1354).
function applyToolCallResult(history: ToolCallHistoryItem[], event: SseToolCallResult): void {
  const entry = findPendingToolCall(history, event.toolUseId);
  if (!entry) return;
  if (event.isError === true) {
    // Clear any prior success content so the UI never shows a stale
    // green `result` chip next to a fresh red `error` chip for the
    // same toolUseId. (Sourcery review on #1357.)
    entry.result = undefined;
    entry.error = event.content;
    const hint = extractMcpHint(entry.toolName);
    if (hint !== null) entry.mcpHint = hint;
    return;
  }
  entry.result = event.content;
}

export function addPendingGeneration(pending: Record<string, PendingGeneration>, event: SseGenerationStarted): void {
  const { kind, filePath, key } = event;
  pending[generationKey(kind, filePath, key)] = { kind, filePath, key };
}

// Returns whether the map is now empty, so the caller can fire the
// drain callback only on the transition to "no background work left".
export function removePendingGeneration(pending: Record<string, PendingGeneration>, event: SseGenerationFinished): boolean {
  Reflect.deleteProperty(pending, generationKey(event.kind, event.filePath, event.key));
  return Object.keys(pending).length === 0;
}

/** Start / finish of a plugin-originated background generation. Folded into
 *  one branch because `applyAgentEvent` sits on the cognitive-complexity
 *  ceiling and every added event type would otherwise break it. */
function applyGenerationEvent(session: ActiveSession, event: SseGenerationStarted | SseGenerationFinished, onDrained: () => void): void {
  if (event.type === EVENT_TYPES.generationStarted) {
    addPendingGeneration(session.pendingGenerations, event);
    return;
  }
  if (removePendingGeneration(session.pendingGenerations, event)) onDrained();
}

/** Session metadata pushed mid-turn. A DELTA — only fields the event actually
 *  carries may overwrite what the session already knows (#2554). */
function applySessionMeta(session: ActiveSession, event: SseSessionMeta): void {
  if (event.resolvedModel) session.resolvedModel = event.resolvedModel;
}

export async function applyAgentEvent(event: SseEvent, ctx: AgentEventContext): Promise<void> {
  const { session } = ctx;
  switch (event.type) {
    case EVENT_TYPES.toolCall:
      session.toolCallHistory.push(toToolCallEntry(event));
      // A tool call closes the current assistant text block: the next
      // streamed delta must open a fresh card, not merge onto the
      // pre-tool prose. See `ActiveSession.assistantTextInterrupted`.
      session.assistantTextInterrupted = true;
      ctx.scrollSidebarToBottom();
      return;
    case EVENT_TYPES.toolCallResult:
      applyToolCallResult(session.toolCallHistory, event);
      ctx.scrollSidebarToBottom();
      return;
    case EVENT_TYPES.status:
      session.statusMessage = event.message;
      return;
    case EVENT_TYPES.rolesUpdated:
      await ctx.refreshRoles();
      return;
    case EVENT_TYPES.text:
      applyTextEvent(session, event.message, event.source ?? "assistant", event.attachments);
      return;
    case EVENT_TYPES.skill:
      applySkillEvent(session, {
        skillName: event.skillName,
        skillScope: event.skillScope,
        skillPath: event.skillPath,
        skillDescription: event.skillDescription,
        message: event.message,
      });
      return;
    case EVENT_TYPES.toolResult:
      // Drop any client-seeded placeholder for this collection first, so the
      // real presentCollection result replaces it instead of stacking.
      reconcileSyntheticCollection(session, event.result);
      applyToolResultToSession(session, event.result);
      return;
    case EVENT_TYPES.error:
      console.error("[agent] error event:", event.message);
      pushErrorMessage(session, event.message);
      return;
    case EVENT_TYPES.sessionFinished:
      return;
    case EVENT_TYPES.generationStarted:
    case EVENT_TYPES.generationFinished:
      applyGenerationEvent(session, event, ctx.onGenerationsDrained);
      return;
    case EVENT_TYPES.sessionMeta:
      applySessionMeta(session, event);
  }
}
