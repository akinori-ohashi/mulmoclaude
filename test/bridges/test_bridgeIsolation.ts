// The isolation claim of #3080 C-4: a bridge that misbehaves costs that bridge,
// never the server. Codex raised both of these in round 1 as unpinned, and each
// is a path where an exception crosses from bridge code onto the server's stack.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInProcessBridgeClient, type InProcessRelayFn, type RegisterInProcessPush } from "@mulmobridge/client";
import { startConfiguredBridges } from "../../server/bridges/registry.js";
import { createChatService } from "@mulmobridge/chat-service";

const okRelay: InProcessRelayFn = async () => ({ kind: "ok", reply: "" });
const noPush: RegisterInProcessPush = () => () => {};

describe("in-process push delivery is contained", () => {
  // `pushToBridge` runs the handler on whatever stack the server was on — a
  // route handler, a scheduler tick. A socket bridge cannot reach the server
  // this way because its handler runs in another process; an in-process one can.
  it("a handler that throws synchronously does not reach the caller", () => {
    const registered: ((event: { chatId: string; message: string }) => void)[] = [];
    const client = createInProcessBridgeClient({
      transportId: "telegram",
      relay: okRelay,
      registerPush: (_id, handler) => {
        registered.push(handler);
        return () => {};
      },
    });
    client.onPush(() => {
      throw new Error("bridge bug");
    });
    assert.doesNotThrow(() => registered[0]?.({ chatId: "1", message: "hi" }));
  });

  it("one bad handler does not stop the handlers after it", () => {
    const registered: ((event: { chatId: string; message: string }) => void)[] = [];
    const client = createInProcessBridgeClient({
      transportId: "telegram",
      relay: okRelay,
      registerPush: (_id, handler) => {
        registered.push(handler);
        return () => {};
      },
    });
    const seen: string[] = [];
    client.onPush(() => {
      throw new Error("bridge bug");
    });
    client.onPush((event) => seen.push(event.message));
    registered[0]?.({ chatId: "1", message: "hi" });
    assert.deepEqual(seen, ["hi"]);
  });
});

describe("chat-service contains a throwing in-process bridge", () => {
  const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const role = { id: "default", name: "Default", systemPrompt: "" };
  const service = () =>
    createChatService({
      startChat: async () => ({ kind: "started" as const, chatSessionId: "s1" }),
      onSessionEvent: () => () => {},
      loadAllRoles: () => [role],
      getRole: () => role,
      defaultRoleId: "default",
      transportsDir: "/tmp/mulmoclaude-bridges-test-3080/transports",
      logger: silent,
    });

  // The server half of the same claim: `pushToBridge` is called from route
  // handlers and scheduler ticks, so a bridge bug reaching this stack is a
  // server crash. Verified by mutation: remove the guard and this goes red.
  it("pushToBridge does not throw when the bridge's handler does", () => {
    const chat = service();
    chat.registerInProcessBridge("telegram", () => {
      throw new Error("bridge bug");
    });
    assert.doesNotThrow(() => chat.pushToBridge("telegram", "1", "hi"));
  });

  it("refuses a second in-process bridge for one transport id", () => {
    const chat = service();
    const unregister = chat.registerInProcessBridge("telegram", () => {});
    assert.throws(() => chat.registerInProcessBridge("telegram", () => {}), /already registered/);
    // …and the slot frees up again once the first one closes.
    unregister();
    assert.doesNotThrow(() => chat.registerInProcessBridge("telegram", () => {}));
  });
});

describe("startConfiguredBridges resolves rather than rejects", () => {
  const host = { relay: okRelay, registerInProcessBridge: noPush };

  // `server/index.ts` exits on `unhandledRejection`, so a rejection here is a
  // dead server — the exact failure this route claims to prevent.
  it("an unreadable config/bridges.json gives an empty result, not a rejection", async () => {
    // A directory where the file should be: the read fails with EISDIR, which
    // `loadJsonFile` rethrows because it is not ENOENT.
    const started = await startConfiguredBridges({ host, workspaceRoot: "/dev/null/not-a-workspace" });
    assert.deepEqual(started.running, []);
    assert.doesNotThrow(() => started.closeAll());
  });

  it("a missing config file is simply no bridges", async () => {
    const started = await startConfiguredBridges({ host, workspaceRoot: "/tmp/mulmoclaude-no-such-workspace-3080" });
    assert.deepEqual(started.running, []);
  });

  it("an enabled bridge that cannot be started leaves the rest of the result usable", async () => {
    // `telegram` is in the starter table but its env is absent here, so
    // `readTelegramEnv` throws inside the registry's per-bridge try/catch.
    const workspace = "/tmp/mulmoclaude-bridges-test-3080";
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(`${workspace}/config`, { recursive: true });
    writeFileSync(`${workspace}/config/bridges.json`, JSON.stringify({ bridges: { telegram: { enabled: true } } }));
    const started = await startConfiguredBridges({ host, workspaceRoot: workspace, env: {} });
    assert.deepEqual(started.running, [], "a bridge whose env is missing must not count as running");
    assert.doesNotThrow(() => started.closeAll());
  });
});
