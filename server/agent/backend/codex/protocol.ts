import { isRecord } from "../../../utils/types.js";

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type CodexUserInput = { type: "text"; text: string } | { type: "localImage"; path: string } | { type: "skill"; name: string; path: string };

export interface CodexThreadItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string;
  exitCode?: number | null;
  changes?: unknown;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  status?: string;
}

export interface CodexNotificationParams {
  item?: CodexThreadItem;
  itemId?: string;
  delta?: string;
  threadId?: string;
  turnId?: string;
  turn?: {
    id?: string;
    status?: string;
    error?: { message?: string } | null;
  };
  error?: { message?: string };
  message?: string;
}

export function isJsonRpcResponse(value: JsonRpcMessage): value is JsonRpcResponse {
  return "id" in value && isJsonRpcId(value.id) && (!("method" in value) || typeof value.method !== "string");
}

export function isJsonRpcRequest(value: JsonRpcMessage): value is JsonRpcRequest {
  return "id" in value && isJsonRpcId(value.id) && "method" in value && typeof value.method === "string";
}

export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (!isRecord(value)) return false;
  const hasMethod = typeof value.method === "string";
  const hasId = isJsonRpcId(value.id);
  return hasMethod || hasId;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "number" || typeof value === "string";
}

export function isCodexNotificationParams(value: unknown): value is CodexNotificationParams {
  if (!isRecord(value)) return false;
  if (value.item !== undefined && !isCodexThreadItem(value.item)) return false;
  if (value.turn !== undefined && !isRecord(value.turn)) return false;
  return true;
}

function isCodexThreadItem(value: unknown): value is CodexThreadItem {
  return isRecord(value) && typeof value.id === "string" && typeof value.type === "string";
}
