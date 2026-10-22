import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Attachment } from "@mulmobridge/protocol";
import { deliverLineEvent, type LineDeliveryDeps } from "../src/deliver.js";
import type { LineEvent, LineEventSource } from "../src/parse.js";

interface Calls {
  loading: string[];
  sent: { chatId: string; text: string; attachments: Attachment[] | undefined }[];
  pushed: { chatId: string; text: string }[];
  downloads: string[];
}

const NO_REFRESH_MS = 60_000;

function recorder(requireMention: boolean): { deps: LineDeliveryDeps; calls: Calls } {
  const calls: Calls = { loading: [], sent: [], pushed: [], downloads: [] };
  const deps: LineDeliveryDeps = {
    requireMention,
    send: async (chatId, text, attachments) => {
      calls.sent.push({ chatId, text, attachments });
      return { ok: true, reply: `echo:${text}` };
    },
    push: async (chatId, text) => {
      calls.pushed.push({ chatId, text });
    },
    startLoading: async (chatId) => {
      calls.loading.push(chatId);
    },
    downloadImage: async (messageId) => {
      calls.downloads.push(messageId);
      return { bytes: Buffer.from("img"), mimeType: "image/png" };
    },
    indicator: { refreshMs: NO_REFRESH_MS, label: "line", log: { warn: () => {} } },
    log: { log: () => {}, error: () => {} },
  };
  return { deps, calls };
}

const selfMention = { mentionees: [{ index: 0, length: 4, type: "user", isSelf: true }] };
const text = (source: LineEventSource, body: string, mention?: unknown): LineEvent => ({
  type: "message",
  source,
  message: { type: "text", text: body, mention },
});
const image = (source: LineEventSource): LineEvent => ({ type: "message", source, message: { type: "image", id: "img1" } });

describe("deliverLineEvent", () => {
  it("one-on-one: loading, send and push all use the raw userId", async () => {
    const { deps, calls } = recorder(true);
    await deliverLineEvent(text({ type: "user", userId: "U1" }, "hi"), deps);
    assert.deepEqual(calls.loading, ["U1"]);
    assert.deepEqual(calls.sent, [{ chatId: "U1", text: "hi", attachments: undefined }]);
    assert.deepEqual(calls.pushed, [{ chatId: "U1", text: "echo:hi" }]);
  });

  it("one-on-one image: downloads and sends to the userId", async () => {
    const { deps, calls } = recorder(true);
    await deliverLineEvent(image({ type: "user", userId: "U1" }), deps);
    assert.deepEqual(calls.downloads, ["img1"]);
    assert.equal(calls.sent[0]?.chatId, "U1");
    assert.equal(calls.sent[0]?.attachments?.[0]?.mimeType, "image/png");
    assert.equal(calls.pushed[0]?.chatId, "U1");
  });

  it("group without a mention: nothing is called", async () => {
    const { deps, calls } = recorder(true);
    await deliverLineEvent(text({ type: "group", groupId: "C1", userId: "U1" }, "chatting"), deps);
    assert.deepEqual(calls, { loading: [], sent: [], pushed: [], downloads: [] });
  });

  it("group with a mention: sends the stripped text and pushes to the group, no loading", async () => {
    const { deps, calls } = recorder(true);
    await deliverLineEvent(text({ type: "group", groupId: "C1", userId: "U1" }, "@bot hi", selfMention), deps);
    assert.deepEqual(calls.loading, []);
    assert.deepEqual(calls.sent, [{ chatId: "C1", text: "hi", attachments: undefined }]);
    assert.deepEqual(calls.pushed, [{ chatId: "C1", text: "echo:hi" }]);
  });

  it("room with a mention: pushes to the roomId", async () => {
    const { deps, calls } = recorder(true);
    await deliverLineEvent(text({ type: "room", roomId: "R1" }, "@bot hi", selfMention), deps);
    assert.deepEqual(calls.pushed, [{ chatId: "R1", text: "echo:hi" }]);
  });

  it("group image under the default gate: skipped without downloading", async () => {
    const { deps, calls } = recorder(true);
    await deliverLineEvent(image({ type: "group", groupId: "C1" }), deps);
    assert.deepEqual(calls, { loading: [], sent: [], pushed: [], downloads: [] });
  });

  it("gate off: an unmentioned group message and image are answered in the group", async () => {
    const { deps, calls } = recorder(false);
    await deliverLineEvent(text({ type: "group", groupId: "C1" }, "chatting"), deps);
    await deliverLineEvent(image({ type: "group", groupId: "C1" }), deps);
    assert.deepEqual(
      calls.pushed.map(({ chatId }) => chatId),
      ["C1", "C1"],
    );
    assert.deepEqual(calls.loading, []);
  });

  it("a failing send is logged, not thrown", async () => {
    const { deps } = recorder(true);
    const errors: string[] = [];
    const failing: LineDeliveryDeps = {
      ...deps,
      send: async () => {
        throw new Error("boom");
      },
      log: { log: () => {}, error: (message) => errors.push(message) },
    };
    await deliverLineEvent(text({ type: "user", userId: "U1" }, "hi"), failing);
    assert.match(errors[0] ?? "", /boom/);
  });
});
