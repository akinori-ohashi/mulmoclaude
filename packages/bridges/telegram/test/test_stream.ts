import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createReplyStream } from "../src/stream.ts";
import type { TelegramApi } from "../src/api.ts";

const INTERVAL_MS = 1000;
const CHAT_ID = 42;

interface Deferred {
  resolve: () => void;
  reject: (err: Error) => void;
}

/** A TelegramApi whose sendMessage stays pending until the test settles it. */
function slowSendApi(): TelegramApi & { sent: string[]; edited: { messageId: number; text: string }[]; pending: Deferred[] } {
  const sent: string[] = [];
  const edited: { messageId: number; text: string }[] = [];
  const pending: Deferred[] = [];
  return {
    sent,
    edited,
    pending,
    async getUpdates() {
      return [];
    },
    sendMessage(_chatId, text) {
      sent.push(text);
      const messageId = sent.length;
      return new Promise<number>((resolve, reject) => {
        pending.push({ resolve: () => resolve(messageId), reject });
      });
    },
    async editMessageText(_chatId, messageId, text) {
      edited.push({ messageId, text });
    },
    async sendChatAction() {},
    async downloadFile() {
      return "";
    },
  };
}

const settleNext = (api: ReturnType<typeof slowSendApi>): void => {
  const next = api.pending.shift();
  assert.ok(next !== undefined, "expected a pending sendMessage");
  next.resolve();
};

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createReplyStream", () => {
  const errors: string[] = [];
  const log = { error: (m: string) => errors.push(m) };

  beforeEach(() => {
    errors.length = 0;
    mock.timers.enable({ apis: ["setInterval"] });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  it("finish waits for a first sendMessage still in flight and returns its id", async () => {
    const api = slowSendApi();
    const stream = createReplyStream(api, CHAT_ID, log, INTERVAL_MS);
    stream.append("partial");
    const finished = stream.finish();
    await turn();
    settleNext(api);
    assert.equal(await finished, 1);
    assert.deepEqual(api.sent, ["partial"]);
  });

  it("finish waits for a first send the timer started", async () => {
    const api = slowSendApi();
    const stream = createReplyStream(api, CHAT_ID, log, INTERVAL_MS);
    stream.append("partial");
    mock.timers.tick(INTERVAL_MS);
    await turn();
    const finished = stream.finish();
    settleNext(api);
    assert.equal(await finished, 1);
    assert.deepEqual(api.sent, ["partial"]);
  });

  it("edits the first message instead of sending a second while the first send is slow", async () => {
    const api = slowSendApi();
    const stream = createReplyStream(api, CHAT_ID, log, INTERVAL_MS);
    stream.append("a");
    mock.timers.tick(INTERVAL_MS);
    await turn();
    stream.append("b");
    mock.timers.tick(INTERVAL_MS);
    await turn();
    assert.equal(api.sent.length, 1);
    settleNext(api);
    assert.equal(await stream.finish(), 1);
    assert.deepEqual(api.sent, ["a"]);
    assert.deepEqual(api.edited, [{ messageId: 1, text: "ab" }]);
  });

  it("sends nothing and returns null when no chunk arrived", async () => {
    const api = slowSendApi();
    const stream = createReplyStream(api, CHAT_ID, log, INTERVAL_MS);
    mock.timers.tick(INTERVAL_MS * 3);
    assert.equal(await stream.finish(), null);
    assert.deepEqual(api.sent, []);
  });

  it("stop halts the timer and ignores later chunks", async () => {
    const api = slowSendApi();
    const stream = createReplyStream(api, CHAT_ID, log, INTERVAL_MS);
    stream.append("pending");
    stream.stop();
    stream.append("late");
    mock.timers.tick(INTERVAL_MS * 3);
    await turn();
    stream.stop();
    assert.deepEqual(api.sent, []);
  });

  it("returns null and logs when the first sendMessage fails", async () => {
    const api = slowSendApi();
    const stream = createReplyStream(api, CHAT_ID, log, INTERVAL_MS);
    stream.append("partial");
    const finished = stream.finish();
    await turn();
    const next = api.pending.shift();
    assert.ok(next !== undefined);
    next.reject(new Error("429"));
    assert.equal(await finished, null);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /stream sendMessage failed: Error: 429/);
  });
});
