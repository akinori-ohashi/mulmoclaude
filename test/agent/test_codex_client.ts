import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CodexAppServerClient, type CodexProcess } from "../../server/agent/backend/codex/client.js";

function fakeProcess(): CodexProcess {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    pid: number;
    kill: () => boolean;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.pid = 1;
  proc.kill = () => {
    proc.killed = true;
    proc.emit("close", 0, null);
    return true;
  };
  return proc as unknown as CodexProcess;
}

async function nextJson(stream: PassThrough): Promise<Record<string, unknown>> {
  const [chunk] = await once(stream, "data");
  return JSON.parse(String(chunk).trim()) as Record<string, unknown>;
}

describe("CodexAppServerClient", () => {
  it("correlates JSONL responses with requests", async () => {
    const proc = fakeProcess();
    const client = new CodexAppServerClient(proc);
    const linePromise = nextJson(proc.stdin as PassThrough);
    const responsePromise = client.request("initialize", { clientInfo: { name: "test" } });
    const request = await linePromise;
    assert.equal(request.method, "initialize");
    (proc.stdout as PassThrough).write(`${JSON.stringify({ id: request.id, result: { ok: true } })}\n`);
    assert.deepEqual(await responsePromise, { ok: true });
    client.close();
  });

  it("declines unexpected approval requests so headless turns cannot hang", async () => {
    const proc = fakeProcess();
    const client = new CodexAppServerClient(proc);
    const responseLine = nextJson(proc.stdin as PassThrough);
    (proc.stdout as PassThrough).write(`${JSON.stringify({ id: 9, method: "item/commandExecution/requestApproval", params: {} })}\n`);
    assert.deepEqual(await responseLine, { id: 9, result: { decision: "decline" } });
    client.close();
  });

  it("answers request-user-input with an empty answer set", async () => {
    const proc = fakeProcess();
    const client = new CodexAppServerClient(proc);
    const responseLine = nextJson(proc.stdin as PassThrough);
    (proc.stdout as PassThrough).write(`${JSON.stringify({ id: 10, method: "item/tool/requestUserInput", params: {} })}\n`);
    assert.deepEqual(await responseLine, { id: 10, result: { answers: {} } });
    client.close();
  });

  it("surfaces malformed JSON as a non-crashing error notification", async () => {
    const proc = fakeProcess();
    const client = new CodexAppServerClient(proc);
    const next = client.notifications().next();
    (proc.stdout as PassThrough).write("{broken}\n");
    const notification = await next;
    assert.equal(notification.value?.method, "error");
    client.close();
  });
});
