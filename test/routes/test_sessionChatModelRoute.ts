// Route-level checks for POST /api/sessions/:id/chat-model (#3147).
//
// This is the one endpoint that lets a client put a value on the
// `claude --model` command line, so the rejection half matters as much as the
// happy path: an alias the app does not know must be a 400, not something
// written to disk and quietly dropped three layers later.
//
// Driven with plain Request / Response mocks, the same shape
// `test_sessionsRoute.ts` uses, so there is no Express harness to pay for.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Request, Response } from "express";

type RouteModule = typeof import("../../server/api/routes/sessions.js");
type IoModule = typeof import("../../server/utils/files/session-io.js");
type Handler = (req: Request, res: Response) => Promise<void> | void;

interface StackFrame {
  route?: { path: string; stack: { method: string; handle: Handler }[] };
}
interface RouterInternals {
  stack: StackFrame[];
}

const extractRouteHandler = (mod: RouteModule, routePath: string, method: string): Handler => {
  const router = mod.default as unknown as RouterInternals;
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((stackLayer) => stackLayer.method === method);
    if (layer) return layer.handle;
  }
  throw new Error(`route ${method.toUpperCase()} ${routePath} not registered`);
};

const mockRes = () => {
  const state: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
};

let root: string;
let originalHome: string | undefined;
let originalWorkspace: string | undefined;
let handler: Handler;
let sessionIo: IoModule;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mulmo-session-chat-model-"));
  originalHome = process.env.HOME;
  originalWorkspace = process.env.MULMOCLAUDE_WORKSPACE_PATH;
  process.env.HOME = root;
  process.env.MULMOCLAUDE_WORKSPACE_PATH = root;
  mkdirSync(path.join(root, "conversations", "chat"), { recursive: true });
  const routes = await import("../../server/api/routes/sessions.js");
  sessionIo = await import("../../server/utils/files/session-io.js");
  handler = extractRouteHandler(routes, "/api/sessions/:id/chat-model", "post");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  else process.env.MULMOCLAUDE_WORKSPACE_PATH = originalWorkspace;
  await rm(root, { recursive: true, force: true });
});

const post = async (sessionId: string, body: unknown) => {
  const { state, res } = mockRes();
  await handler({ params: { id: sessionId }, body } as unknown as Request, res);
  return state;
};

describe("POST /api/sessions/:id/chat-model", () => {
  it("stores a known alias", async () => {
    await sessionIo.createSessionMeta("cm-1", "general", "hi");
    const state = await post("cm-1", { chatModel: "opus" });
    assert.equal(state.status, 200);
    assert.equal((await sessionIo.readSessionMeta("cm-1"))?.chatModel, "opus");
  });

  it("clears the override on null, removing the key", async () => {
    await sessionIo.createSessionMeta("cm-2", "general", "hi");
    await post("cm-2", { chatModel: "opus" });
    const state = await post("cm-2", { chatModel: null });
    assert.equal(state.status, 200);
    const meta = await sessionIo.readSessionMeta("cm-2");
    assert.equal("chatModel" in (meta ?? {}), false);
  });

  it("treats an absent field as a clear, not as a no-op", async () => {
    await sessionIo.createSessionMeta("cm-3", "general", "hi");
    await post("cm-3", { chatModel: "haiku" });
    await post("cm-3", {});
    assert.equal((await sessionIo.readSessionMeta("cm-3"))?.chatModel, undefined);
  });

  // The rejection half. Without it a client could put an arbitrary string on
  // the CLI's command line, or — worse — write one that only fails much later.
  it("rejects an unknown alias with 400 and writes nothing", async () => {
    await sessionIo.createSessionMeta("cm-4", "general", "hi");
    await post("cm-4", { chatModel: "haiku" });
    const state = await post("cm-4", { chatModel: "gpt-4o" });
    assert.equal(state.status, 400);
    assert.equal((await sessionIo.readSessionMeta("cm-4"))?.chatModel, "haiku", "the prior value must survive a rejected write");
  });

  it("rejects non-string values", async () => {
    await sessionIo.createSessionMeta("cm-5", "general", "hi");
    for (const bad of [42, true, {}, []]) {
      assert.equal((await post("cm-5", { chatModel: bad })).status, 400, `${JSON.stringify(bad)} must be rejected`);
    }
    assert.equal((await sessionIo.readSessionMeta("cm-5"))?.chatModel, undefined);
  });

  // `session-io` refuses these anyway; the point here is that the ROUTE does
  // not answer 200 for a write that never happened. Reproduced over real HTTP
  // before the guard: Express hands `..%2F..%2Fconfig%2Fsettings` through as
  // `../../config/settings`, and session-io resolved it onto the workspace's
  // own settings file.
  it("rejects a session id that is not path-safe", async () => {
    for (const hostile of ["../../config/settings", "..", "a/../b", "foo/bar"]) {
      assert.equal((await post(hostile, { chatModel: "opus" })).status, 400, `${hostile} must be rejected`);
    }
  });

  it("rejects the empty string rather than storing it as a shadowing value", async () => {
    await sessionIo.createSessionMeta("cm-6", "general", "hi");
    assert.equal((await post("cm-6", { chatModel: "" })).status, 400);
  });
});
