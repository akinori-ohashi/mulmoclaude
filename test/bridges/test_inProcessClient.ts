// The in-process `BridgeClient` (#3080) is the third caller of chat-service's
// `RelayFn`, after the HTTP router and socket.io. These pin the parts a bridge
// can tell apart from the socket client.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInProcessBridgeClient, type InProcessRelayFn, type RegisterInProcessPush } from "@mulmobridge/client";

const okRelay: InProcessRelayFn = async () => ({ kind: "ok", reply: "hi" });
const noPush: RegisterInProcessPush = () => () => {};

describe("createInProcessBridgeClient", () => {
  it("turns a relay ok into an ack and an error into ok:false", async () => {
    const ok = createInProcessBridgeClient({ transportId: "telegram", relay: okRelay, registerPush: noPush });
    assert.deepEqual(await ok.send("42", "hello"), { ok: true, reply: "hi" });

    const bad = createInProcessBridgeClient({
      transportId: "telegram",
      relay: async () => ({ kind: "error", status: 404, message: "no such chat" }),
      registerPush: noPush,
    });
    assert.deepEqual(await bad.send("42", "hello"), { ok: false, error: "no such chat", status: 404 });
  });

  it("passes the transport id and attachments through to the relay", async () => {
    const seen: Parameters<InProcessRelayFn>[0][] = [];
    const client = createInProcessBridgeClient({
      transportId: "telegram",
      relay: async (params) => {
        seen.push(params);
        return { kind: "ok", reply: "" };
      },
      registerPush: noPush,
    });
    await client.send("42", "hi", [{ mimeType: "image/png", data: "aGk=" }]);
    assert.equal(seen[0]?.transportId, "telegram");
    assert.equal(seen[0]?.externalChatId, "42");
    assert.equal(seen[0]?.attachments?.length, 1);
  });

  // The serialiser should not pay for a stream nobody reads.
  it("only asks the relay for chunks once someone subscribes", async () => {
    const asked: boolean[] = [];
    const client = createInProcessBridgeClient({
      transportId: "telegram",
      relay: async (params) => {
        asked.push(params.onChunk !== undefined);
        params.onChunk?.("piece");
        return { kind: "ok", reply: "" };
      },
      registerPush: noPush,
    });
    await client.send("42", "before");
    const chunks: string[] = [];
    client.onTextChunk((chunk) => chunks.push(chunk));
    await client.send("42", "after");
    assert.deepEqual(asked, [false, true]);
    assert.deepEqual(chunks, ["piece"]);
  });

  it("registers for pushes once, on the first subscriber, and unregisters on close", () => {
    let registrations = 0;
    let unregistered = 0;
    const client = createInProcessBridgeClient({
      transportId: "telegram",
      relay: okRelay,
      registerPush: () => {
        registrations += 1;
        return () => {
          unregistered += 1;
        };
      },
    });
    assert.equal(registrations, 0, "a bridge that never listens costs the host nothing");
    client.onPush(() => {});
    client.onPush(() => {});
    assert.equal(registrations, 1);
    client.close();
    client.close();
    assert.equal(unregistered, 1, "close is idempotent");
  });

  it("delivers a push to every subscriber", () => {
    // Collected rather than held in a `let` the compiler narrows to null: the
    // assignment happens inside a callback it cannot follow.
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
    client.onPush((event) => seen.push(`a:${event.message}`));
    client.onPush((event) => seen.push(`b:${event.message}`));
    assert.equal(registered.length, 1);
    registered[0]?.({ chatId: "42", message: "ping" });
    assert.deepEqual(seen, ["a:ping", "b:ping"]);
  });

  it("refuses to send after close rather than reaching the relay", async () => {
    let calls = 0;
    const client = createInProcessBridgeClient({
      transportId: "telegram",
      relay: async () => {
        calls += 1;
        return { kind: "ok", reply: "" };
      },
      registerPush: noPush,
    });
    client.close();
    const ack = await client.send("42", "hi");
    assert.equal(ack.ok, false);
    assert.equal(calls, 0);
  });

  // Measured across all 25 bridges: none reads `.socket`. A null would surface
  // later as an unrelated TypeError; this says what is wrong at the access.
  it("throws on the socket escape hatch instead of handing back a null", () => {
    const client = createInProcessBridgeClient({ transportId: "telegram", relay: okRelay, registerPush: noPush });
    assert.throws(() => client.socket, /no socket/);
  });
});
