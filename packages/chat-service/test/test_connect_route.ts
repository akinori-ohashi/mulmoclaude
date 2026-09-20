// HTTP integration test for the `/connect` route (#1894 follow-up to #1888):
// verifies the route resolves the target session's role via the DI-injected
// `getSessionRole`, then passes it through to `store.connectSession` — so the
// persisted bridge state's `roleId` tracks the new session's role, avoiding
// the same drift the `/switch` command was hit by.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createChatService } from "../src/index.ts";
import { createChatStateStore } from "../src/chat-state.ts";
import type { ChatServiceDeps, Logger } from "../src/types.ts";

const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

interface HarnessOpts {
  getSessionRole?: ((sessionId: string) => Promise<string | null>) | undefined;
}

interface Harness {
  url: string;
  transportsDir: string;
  seedState: (transportId: string, externalChatId: string, roleId: string, sessionId: string) => Promise<void>;
  readState: (transportId: string, externalChatId: string) => Promise<{ sessionId: string; roleId: string } | null>;
  connectCalls: Array<{ sessionId: string; roleId?: string | undefined }>;
}

async function startHarness(opts: HarnessOpts = {}): Promise<{ harness: Harness; shutdown: () => Promise<void> }> {
  const transportsDir = mkdtempSync(path.join(tmpdir(), "connect-route-"));
  const connectCalls: Array<{ sessionId: string; roleId?: string | undefined }> = [];

  // Real store for readback, but wrapped to capture connectSession args so we
  // can pin the exact roleId the route passed through.
  const store = createChatStateStore({ transportsDir, logger: silentLogger });
  const originalConnect = store.connectSession;
  store.connectSession = async (t, c, sid, roleId) => {
    connectCalls.push({ sessionId: sid, roleId });
    return originalConnect(t, c, sid, roleId);
  };

  // Minimal deps stub — everything below what the /connect route touches is a
  // no-op. `startChat` etc. are typed non-nullable on ChatServiceDeps, so
  // stub them out; if the route ever calls them the test will fail loudly.
  const deps: ChatServiceDeps = {
    startChat: async () => {
      throw new Error("startChat should not be called by /connect");
    },
    onSessionEvent: () => () => undefined,
    loadAllRoles: () => [],
    getRole: () => ({ id: "unused", name: "Unused" }),
    defaultRoleId: "general",
    transportsDir,
    logger: silentLogger,
    ...(opts.getSessionRole === undefined ? {} : { getSessionRole: opts.getSessionRole }),
  };

  // Swap createChatStateStore's factory so createChatService uses OUR wrapped
  // store instead of a fresh one. Simplest way: call createChatService, then
  // reach in — but that's a private-field poke. Cleaner: don't use
  // createChatService here; construct the router manually with the same shape.
  // Since we only care about the /connect route wiring, this is fine.
  const service = createChatService(deps);
  // createChatService constructs its own store internally, so `connectCalls`
  // above wouldn't capture. Bypass: seed / read via a store rooted at the
  // SAME transportsDir; the file layout matches, so what the service writes,
  // we read below. connectCalls stays empty (which is fine — we assert on
  // the persisted state instead of the call spy).
  const observedStore = createChatStateStore({ transportsDir, logger: silentLogger });

  const app = express();
  app.use(express.json());
  app.use(service.router);
  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}`;

  const harness: Harness = {
    url,
    transportsDir,
    connectCalls,
    seedState: async (transportId, externalChatId, roleId, sessionId) => {
      // reset then connect (real API) to lay down a state with the given role
      // and sessionId. resetChatState creates it; connectSession would repoint.
      const reset = await observedStore.resetChatState(transportId, externalChatId, roleId);
      // Sanity: reset gives us a state with the requested role. Then update
      // the sessionId to the seed value via a direct setChatState.
      await observedStore.setChatState(transportId, { ...reset, sessionId });
    },
    readState: async (transportId, externalChatId) => {
      const state = await observedStore.getChatState(transportId, externalChatId);
      return state ? { sessionId: state.sessionId, roleId: state.roleId } : null;
    },
  };

  const shutdown = async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    rmSync(transportsDir, { recursive: true, force: true });
  };

  return { harness, shutdown };
}

describe("POST /connect — role propagation (issue #1894)", () => {
  // Every test brings up its own harness (fresh port + tmp transports dir);
  // afterEach tears it down BEFORE the next `it()` re-assigns `currentShutdown`.
  // A suite-level `after` would only close the last harness and leak the
  // earlier ones' HTTP servers + tmp dirs (CodeRabbit review on #1895).
  let currentShutdown: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (!currentShutdown) return;
    const shutdown = currentShutdown;
    currentShutdown = null;
    await shutdown();
  });

  it("resolves the target session's role and stamps it into the persisted state", async () => {
    // The bridge chat is currently in `general`. `/connect` retargets it at
    // `office-session-42`, whose role is "office" per the injected resolver.
    // The persisted state must land on `roleId: "office"` — that's what the
    // next relay's startChat picks up.
    const { harness, shutdown } = await startHarness({
      getSessionRole: async (sessionId) => (sessionId === "office-session-42" ? "office" : null),
    });
    currentShutdown = shutdown;

    await harness.seedState("telegram", "chat-1", "general", "sess-general");

    const response = await fetch(`${harness.url}/api/transports/telegram/chats/chat-1/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatSessionId: "office-session-42" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean };
    assert.equal(body.ok, true);

    const state = await harness.readState("telegram", "chat-1");
    assert.ok(state);
    assert.equal(state?.sessionId, "office-session-42");
    assert.equal(state?.roleId, "office", "persisted state must reflect the target session's role");
  });

  it("preserves the previous role when the resolver returns null (unknown session)", async () => {
    // A DI resolver that can't identify the session (missing metadata, corrupt
    // file, deleted session) returns null. The route MUST fall back to the
    // previous behaviour: preserve the current state's role. Otherwise a bad
    // lookup would silently blank out the role.
    const { harness, shutdown } = await startHarness({
      getSessionRole: async () => null,
    });
    currentShutdown = shutdown;

    await harness.seedState("telegram", "chat-1", "general", "sess-general");
    const response = await fetch(`${harness.url}/api/transports/telegram/chats/chat-1/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatSessionId: "unknown-session" }),
    });
    assert.equal(response.status, 200);

    const state = await harness.readState("telegram", "chat-1");
    assert.ok(state);
    assert.equal(state?.sessionId, "unknown-session");
    assert.equal(state?.roleId, "general", "null resolver ⇒ preserve prior role, don't blank");
  });

  it("preserves the previous role when no resolver is wired (backward compat)", async () => {
    // Hosts that haven't wired `getSessionRole` at all — the field is
    // optional. The route must keep the old session-id-only semantics
    // (preserve current role) so upgrading chat-service without wiring the
    // new dep doesn't change behaviour.
    const { harness, shutdown } = await startHarness({ getSessionRole: undefined });
    currentShutdown = shutdown;

    await harness.seedState("telegram", "chat-1", "general", "sess-general");
    const response = await fetch(`${harness.url}/api/transports/telegram/chats/chat-1/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatSessionId: "any-session" }),
    });
    assert.equal(response.status, 200);

    const state = await harness.readState("telegram", "chat-1");
    assert.ok(state);
    assert.equal(state?.sessionId, "any-session", "no resolver still repoints the session (only the role stays put)");
    assert.equal(state?.roleId, "general", "no resolver ⇒ preserve prior role (backward compat)");
  });

  it("preserves the previous role when the resolver throws (codex review on #1895)", async () => {
    // Third fallback path documented in the /connect handler: a host-provided
    // resolver that throws (bug, timeout, IO error) must be caught inside the
    // route so an API caller sees a 200 with role preserved instead of a
    // 500 bubble. The MulmoClaude host's resolver is already hardened, but
    // the DI contract doesn't require every host to be — the route defends
    // itself.
    const { harness, shutdown } = await startHarness({
      getSessionRole: async () => {
        throw new Error("resolver blew up");
      },
    });
    currentShutdown = shutdown;

    await harness.seedState("telegram", "chat-1", "general", "sess-general");
    const response = await fetch(`${harness.url}/api/transports/telegram/chats/chat-1/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatSessionId: "some-session" }),
    });
    assert.equal(response.status, 200, "throw must not bubble as 500");

    const state = await harness.readState("telegram", "chat-1");
    assert.ok(state);
    assert.equal(state?.sessionId, "some-session", "session should still be repointed");
    assert.equal(state?.roleId, "general", "throw ⇒ preserve prior role, same as null-return path");
  });

  it("returns 400 when the chatSessionId body value has an unsafe format (issue #1896)", async () => {
    // /connect body values reach the persisted state file, and downstream
    // commands like /history read that sessionId back into `readSessionJsonl`
    // whose underlying reader has no traversal guard. Reject at the entry
    // so the state file can never be poisoned in the first place.
    const { harness, shutdown } = await startHarness({
      getSessionRole: async () => "office",
    });
    currentShutdown = shutdown;

    await harness.seedState("telegram", "chat-1", "general", "sess-original");

    for (const hostile of ["../etc/passwd", "..", "chat/../../etc", "a/b"]) {
      const response = await fetch(`${harness.url}/api/transports/telegram/chats/chat-1/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatSessionId: hostile }),
      });
      assert.equal(response.status, 400, `hostile ${JSON.stringify(hostile)} must be rejected with 400`);
      // The state file MUST stay on the original sessionId — no poisoning.
      const state = await harness.readState("telegram", "chat-1");
      assert.equal(state?.sessionId, "sess-original", `state must not be poisoned by ${JSON.stringify(hostile)}`);
      assert.equal(state?.roleId, "general");
    }
  });

  it("returns 404 when no chat state exists yet for the transport chat", async () => {
    // The route was already 404 in this case; we just want to make sure the
    // new resolver path doesn't accidentally create a state or change the
    // error semantics.
    const { harness, shutdown } = await startHarness({
      getSessionRole: async () => "office",
    });
    currentShutdown = shutdown;

    // No seedState call — the chat doesn't exist.
    const response = await fetch(`${harness.url}/api/transports/telegram/chats/never-existed/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatSessionId: "any" }),
    });
    assert.equal(response.status, 404);
  });
});
