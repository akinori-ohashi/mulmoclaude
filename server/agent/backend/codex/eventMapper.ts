import { EVENT_TYPES } from "../../../../src/types/events.js";
import { isRecord } from "../../../utils/types.js";
import type { AgentEvent } from "../../stream.js";
import { isCodexNotificationParams, type CodexNotificationParams, type CodexThreadItem, type JsonRpcNotification } from "./protocol.js";

export class CodexEventMapper {
  private readonly streamedAgentItems = new Set<string>();
  private errorEmitted = false;

  map(notification: JsonRpcNotification): AgentEvent[] {
    const params = isCodexNotificationParams(notification.params) ? notification.params : undefined;
    if (notification.method === "item/agentMessage/delta") return this.mapTextDelta(params);
    if (notification.method === "item/started") return mapStartedItem(params?.item);
    if (notification.method === "item/completed") return this.mapCompletedItem(params?.item);
    if (notification.method === "error") return this.mapError(errorText(params));
    if (notification.method === "turn/completed") return this.mapTurnCompleted(params);
    return [];
  }

  private mapTextDelta(params: CodexNotificationParams | undefined): AgentEvent[] {
    if (typeof params?.delta !== "string") return [];
    if (typeof params.itemId === "string") this.streamedAgentItems.add(params.itemId);
    return [{ type: EVENT_TYPES.text, message: params.delta }];
  }

  private mapCompletedItem(item: CodexThreadItem | undefined): AgentEvent[] {
    if (!item) return [];
    if (item.type === "agentMessage") return this.mapCompletedMessage(item);
    const completed = mapCompletedTool(item);
    return completed ? [completed] : [];
  }

  private mapCompletedMessage(item: CodexThreadItem): AgentEvent[] {
    if (this.streamedAgentItems.has(item.id) || typeof item.text !== "string") return [];
    return [{ type: EVENT_TYPES.text, message: item.text }];
  }

  private mapError(message: string): AgentEvent[] {
    if (this.errorEmitted) return [];
    this.errorEmitted = true;
    return [{ type: EVENT_TYPES.error, message }];
  }

  private mapTurnCompleted(params: CodexNotificationParams | undefined): AgentEvent[] {
    if (params?.turn?.status !== "failed") return [];
    return this.mapError(params.turn.error?.message ?? "Codex turn failed");
  }
}

function mapStartedItem(item: CodexThreadItem | undefined): AgentEvent[] {
  if (!item) return [];
  const toolName = toolNameFor(item);
  if (!toolName) return [];
  return [{ type: EVENT_TYPES.toolCall, toolUseId: item.id, toolName, args: toolArgs(item) }];
}

function mapCompletedTool(item: CodexThreadItem): AgentEvent | null {
  if (!toolNameFor(item)) return null;
  const event: AgentEvent = {
    type: EVENT_TYPES.toolCallResult,
    toolUseId: item.id,
    content: toolResult(item),
  };
  if (toolFailed(item)) event.isError = true;
  return event;
}

function toolNameFor(item: CodexThreadItem): string | null {
  if (item.type === "commandExecution") return "shell_command";
  if (item.type === "fileChange") return "apply_patch";
  if (item.type === "mcpToolCall" && item.server && item.tool) return `mcp__${item.server}__${item.tool}`;
  return null;
}

function toolArgs(item: CodexThreadItem): unknown {
  if (item.type === "commandExecution") return { command: item.command, cwd: item.cwd };
  if (item.type === "fileChange") return { changes: item.changes };
  return item.arguments ?? {};
}

function toolResult(item: CodexThreadItem): string {
  if (item.type === "commandExecution") return item.aggregatedOutput ?? exitSummary(item.exitCode);
  if (item.type === "fileChange") return stringify(item.changes ?? { status: item.status });
  return stringify(item.error ?? item.result ?? { status: item.status });
}

function toolFailed(item: CodexThreadItem): boolean {
  if (item.type === "commandExecution") return typeof item.exitCode === "number" && item.exitCode !== 0;
  return item.status === "failed" || item.error !== undefined;
}

function exitSummary(exitCode: number | null | undefined): string {
  return exitCode === undefined || exitCode === null ? "" : `Process exited with code ${exitCode}`;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

function errorText(params: CodexNotificationParams | undefined): string {
  if (typeof params?.error?.message === "string") return params.error.message;
  if (typeof params?.message === "string") return params.message;
  if (isRecord(params) && typeof params.message === "string") return params.message;
  return "Codex app-server error";
}
