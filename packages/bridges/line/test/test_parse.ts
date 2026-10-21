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
  it("returns kind:text + chatId (the userId) + text for a normal text message", () => {
    assert.deepEqual(extractIncomingLineMessage(textEvent()), { kind: "text", chatId: "U1234", chatType: "user", mentionsBot: false, text: "hello" });
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
  it("returns kind:image + chatId (the userId) + imageMessageId for an image event", () => {
    assert.deepEqual(extractIncomingLineMessage(imageEvent()), {
      kind: "image",
      chatId: "U1234",
      chatType: "user",
      mentionsBot: false,
      imageMessageId: "msg-img-9999",
    });
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

describe("extractIncomingLineMessage — group / room (#3567)", () => {
  const selfMention = { mentionees: [{ index: 0, length: 4, type: "user", isSelf: true }] };

  it("keys a group message by groupId and keeps the mention flag", () => {
    const event = textEvent({ source: { type: "group", groupId: "C1", userId: "U1" }, message: { type: "text", text: "@bot hi", mention: selfMention } });
    assert.deepEqual(extractIncomingLineMessage(event), { kind: "text", chatId: "C1", chatType: "group", mentionsBot: true, text: "hi" });
  });

  it("keys a room message by roomId", () => {
    const result = extractIncomingLineMessage(textEvent({ source: { type: "room", roomId: "R1", userId: "U1" } }));
    assert.equal(result?.chatId, "R1");
    assert.equal(result?.chatType, "room");
    assert.equal(result?.mentionsBot, false);
  });

  it("keeps a group message whose sender has no userId (not a friend of the bot)", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ source: { type: "group", groupId: "C1" } }))?.chatId, "C1");
  });

  it("drops a group / room event without its id rather than replying elsewhere", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ source: { type: "group", userId: "U1" } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ source: { type: "room", userId: "U1", roomId: "" } })), null);
  });

  it("drops a message that is only the bot's mention", () => {
    const event = textEvent({ source: { type: "group", groupId: "C1" }, message: { type: "text", text: "@bot", mention: selfMention } });
    assert.equal(extractIncomingLineMessage(event), null);
  });

  it("reads a malformed mention as not mentioned instead of dropping the event", () => {
    const event = textEvent({ source: { type: "group", groupId: "C1" }, message: { type: "text", text: "hi", mention: "broken" } });
    assert.deepEqual(extractIncomingLineMessage(event), { kind: "text", chatId: "C1", chatType: "group", mentionsBot: false, text: "hi" });
  });
});

describe("extractIncomingLineMessage — one-on-one key is unchanged (#3567)", () => {
  const sampleIds = ["U1234", "Uabcdef0123456789abcdef0123456789", "U0", "x"];
  const sampleTexts = ["hello", "  spaced  ", "@someone hi", "日本語 😀"];
  const sources = (userId: string) => [{ userId }, { type: "user", userId }, { type: "unknown", userId }];

  it("chatId is the raw userId and text is passed on verbatim", () => {
    sampleIds.forEach((userId) =>
      sampleTexts.forEach((text) =>
        sources(userId).forEach((source) => {
          const result = extractIncomingLineMessage(textEvent({ source, message: { type: "text", text } }));
          assert.deepEqual(result, { kind: "text", chatId: userId, chatType: "user", mentionsBot: false, text });
        }),
      ),
    );
  });
});

describe("parseLineWebhookBody — source fields (#3567)", () => {
  it("accepts group / room sources", () => {
    const events = [
      { type: "message", source: { type: "group", groupId: "C1", userId: "U1" } },
      { type: "message", source: { type: "room", roomId: "R1" } },
    ];
    assert.deepEqual(parseLineWebhookBody(JSON.stringify({ events })), { events });
  });

  it("drops an event whose groupId / roomId is not a string", () => {
    const events = [
      { type: "message", source: { type: "group", groupId: 1 } },
      { type: "message", source: { type: "room", roomId: {} } },
    ];
    assert.deepEqual(parseLineWebhookBody(JSON.stringify({ events })), { events: [] });
  });

  it("keeps an event whose mention is malformed", () => {
    const events = [{ type: "message", message: { type: "text", text: "hi", mention: 42 } }];
    assert.deepEqual(parseLineWebhookBody(JSON.stringify({ events })), { events });
  });
});
