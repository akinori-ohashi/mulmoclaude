import { createInterface } from "node:readline";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { CODEX_RPC_TIMEOUT_MS } from "../../../utils/time.js";
import { errorMessage } from "../../../utils/errors.js";
import { isJsonRpcMessage, isJsonRpcRequest, isJsonRpcResponse, type JsonRpcId, type JsonRpcMessage, type JsonRpcNotification } from "./protocol.js";

export type CodexProcess = ChildProcessByStdio<Writable, Readable, Readable>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexAppServerClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly queued: JsonRpcNotification[] = [];
  private readonly waiters: ((value: JsonRpcNotification | null) => void)[] = [];
  private ended = false;

  constructor(readonly process: CodexProcess) {
    const lines = createInterface({ input: process.stdout });
    lines.on("line", (line) => this.onLine(line));
    process.once("close", () => this.closeQueue(new Error("codex app-server exited")));
    process.once("error", (error) => this.closeQueue(error));
    process.stdin.on("error", (error) => this.closeQueue(error));
  }

  request(method: string, params?: unknown, timeoutMs = CODEX_RPC_TIMEOUT_MS): Promise<unknown> {
    const requestId = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => this.rejectTimedOut(requestId, method), timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.write({ id: requestId, method, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  async *notifications(): AsyncGenerator<JsonRpcNotification> {
    while (true) {
      const notification = await this.nextNotification();
      if (notification === null) return;
      yield notification;
    }
  }

  close(): void {
    if (!this.process.stdin.destroyed) this.process.stdin.end();
    if (!this.process.killed) this.process.kill();
  }

  private onLine(line: string): void {
    const message = parseMessage(line);
    if (!message) return;
    if (isJsonRpcResponse(message)) {
      this.resolveResponse(message.id, message.result, message.error?.message);
      return;
    }
    if (isJsonRpcRequest(message)) {
      this.declineServerRequest(message);
      return;
    }
    this.enqueue(message);
  }

  private resolveResponse(requestId: JsonRpcId, result: unknown, error?: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (error) pending.reject(new Error(error));
    else pending.resolve(result);
  }

  private declineServerRequest(request: { id: JsonRpcId; method: string }): void {
    try {
      this.write({ id: request.id, result: declinedResult(request.method) });
    } catch (error) {
      this.closeQueue(error instanceof Error ? error : new Error(errorMessage(error)));
    }
  }

  private enqueue(notification: JsonRpcNotification): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(notification);
    else this.queued.push(notification);
  }

  private nextNotification(): Promise<JsonRpcNotification | null> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private rejectTimedOut(requestId: JsonRpcId, method: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.reject(new Error(`codex app-server request timed out: ${method}`));
  }

  private closeQueue(reason: Error): void {
    if (this.ended) return;
    this.ended = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  private write(message: object): void {
    if (this.ended || this.process.stdin.destroyed) throw new Error("codex app-server stdin is closed");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
}

function declinedResult(method: string): object {
  if (method === "tool/requestUserInput" || method === "item/tool/requestUserInput") return { answers: {} };
  if (method === "mcpServer/elicitation/request") return { action: "decline", content: null };
  if (method === "item/permissions/requestApproval") return { permissions: [], scope: "turn" };
  return { decision: "decline" };
}

function parseMessage(line: string): JsonRpcMessage | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isJsonRpcMessage(parsed) ? parsed : null;
  } catch (error) {
    return { method: "error", params: { error: { message: `Malformed app-server JSON: ${errorMessage(error)}` } } };
  }
}
