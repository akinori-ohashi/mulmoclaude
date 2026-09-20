import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractIncomingLineMessage, parseLineWebhookBody, type LineEvent } from "../src/parse.js";

function textEvent(overrides: Partial<LineEvent> = {}): LineEvent {
  return {
    type: "message",
    message: { type: "text", text: "hello" },
    source: { userId: "U1234" },
    ...overrides,
  };
}

function imageEvent(overrides: Partial<LineEvent> = {}): LineEvent {
  return {
    type: "message",
    message: { type: "image", id: "msg-img-9999" },
    source: { userId: "U1234" },
    ...overrides,
  };
}

describe("extractIncomingLineMessage — text branch", () => {
  it("returns kind:text + userId + text for a normal text message", () => {
    assert.deepEqual(extractIncomingLineMessage(textEvent()), { kind: "text", userId: "U1234", text: "hello" });
  });

  it("returns null for non-message event types", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ type: "follow" })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ type: "unfollow" })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ type: "postback" })), null);
  });

  it("returns null when message type is unsupported (sticker / video)", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "sticker" } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "video", id: "v1" } })), null);
  });

  it("returns null when message is missing entirely", () => {
    assert.equal(extractIncomingLineMessage({ type: "message", source: { userId: "U1" } }), null);
  });

  it("returns null when source.userId is missing", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ source: { type: "user" } })), null);
    assert.equal(extractIncomingLineMessage({ type: "message", message: { type: "text", text: "hello" } }), null);
  });

  it("returns null for empty / whitespace text", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "text", text: "" } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "text", text: "   " } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "text" } })), null);
  });

  it("preserves text without trimming (sender's whitespace inside is intentional)", () => {
    const result = extractIncomingLineMessage(textEvent({ message: { type: "text", text: "  hello  world  " } }));
    assert.equal(result?.kind, "text");
    if (result?.kind === "text") {
      assert.equal(result.text, "  hello  world  ");
    }
  });
});

describe("extractIncomingLineMessage — image branch (#1222 PR-C)", () => {
  it("returns kind:image + userId + imageMessageId for an image event", () => {
    assert.deepEqual(extractIncomingLineMessage(imageEvent()), { kind: "image", userId: "U1234", imageMessageId: "msg-img-9999" });
  });

  it("returns null when image message id is missing", () => {
    assert.equal(extractIncomingLineMessage(imageEvent({ message: { type: "image" } })), null);
  });

  it("returns null when image message id is empty", () => {
    assert.equal(extractIncomingLineMessage(imageEvent({ message: { type: "image", id: "" } })), null);
  });

  it("returns null when image message id is non-string (defensive)", () => {
    assert.equal(extractIncomingLineMessage(imageEvent({ message: { type: "image", id: 42 as unknown as string } })), null);
  });

  it("still requires source.userId for images", () => {
    assert.equal(extractIncomingLineMessage({ type: "message", message: { type: "image", id: "msg-img-9999" } }), null);
  });
});

describe("parseLineWebhookBody", () => {
  it("returns the body for valid JSON with events array", () => {
    const json = JSON.stringify({ events: [{ type: "message" }] });
    assert.deepEqual(parseLineWebhookBody(json), { events: [{ type: "message" }] });
  });

  it("returns body with empty events array", () => {
    assert.deepEqual(parseLineWebhookBody('{"events": []}'), { events: [] });
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseLineWebhookBody("not json"), null);
    assert.equal(parseLineWebhookBody("{"), null);
    assert.equal(parseLineWebhookBody(""), null);
  });

  it("returns null when 'events' is missing", () => {
    assert.equal(parseLineWebhookBody("{}"), null);
    assert.equal(parseLineWebhookBody('{"foo": "bar"}'), null);
  });

  it("returns null when 'events' is not an array", () => {
    assert.equal(parseLineWebhookBody('{"events": "nope"}'), null);
    assert.equal(parseLineWebhookBody('{"events": null}'), null);
    assert.equal(parseLineWebhookBody('{"events": {}}'), null);
  });

  it("returns null for JSON null / number / string", () => {
    assert.equal(parseLineWebhookBody("null"), null);
    assert.equal(parseLineWebhookBody("42"), null);
    assert.equal(parseLineWebhookBody('"string"'), null);
  });
});
