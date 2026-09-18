import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideMessage,
  parseDmAccess,
  parseInvocationMode,
  stripBotMention,
  validateMessagePolicyConfig,
  type MessagePolicyConfig,
  type SlackMessageEvent,
} from "../src/messagePolicy.ts";

const BOT_ID = "U_BOT";
const ALLOWED_USER = "U_ALLOWED";
const ALLOWED_CHANNEL = "C_ALLOWED";

function config(overrides: Partial<MessagePolicyConfig> = {}): MessagePolicyConfig {
  return {
    invocationMode: "mention",
    dmAccess: "user",
    allowedUsers: new Set([ALLOWED_USER]),
    allowedChannels: new Set([ALLOWED_CHANNEL]),
    botUserId: BOT_ID,
    ...overrides,
  };
}

function event(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return {
    user: ALLOWED_USER,
    channel: ALLOWED_CHANNEL,
    channel_type: "channel",
    text: `<@${BOT_ID}> summarize this`,
    ts: "1800000000.000100",
    ...overrides,
  };
}

describe("message policy config parsing", () => {
  it("keeps legacy-compatible defaults", () => {
    assert.equal(parseInvocationMode(undefined), "all");
    assert.equal(parseDmAccess(undefined), "channel");
  });

  it("accepts supported values case-insensitively", () => {
    assert.equal(parseInvocationMode("MENTION"), "mention");
    assert.equal(parseInvocationMode("all"), "all");
    assert.equal(parseDmAccess("USER"), "user");
    assert.equal(parseDmAccess("channel"), "channel");
  });

  it("rejects empty and unknown values", () => {
    assert.throws(() => parseInvocationMode(""), /Invalid SLACK_INVOCATION_MODE/);
    assert.throws(() => parseInvocationMode("thread"), /Invalid SLACK_INVOCATION_MODE/);
    assert.throws(() => parseDmAccess(""), /Invalid SLACK_DM_ACCESS/);
    assert.throws(() => parseDmAccess("all"), /Invalid SLACK_DM_ACCESS/);
  });

  it("requires a resolved bot identity in mention mode", () => {
    assert.throws(() => validateMessagePolicyConfig(config({ botUserId: null })), /bot user ID/);
  });

  it("requires an explicit user allowlist for user-gated DMs", () => {
    assert.throws(() => validateMessagePolicyConfig(config({ allowedUsers: new Set() })), /SLACK_ALLOWED_USERS/);
  });

  it("allows legacy all/channel mode with empty allowlists", () => {
    assert.doesNotThrow(() =>
      validateMessagePolicyConfig(
        config({
          invocationMode: "all",
          dmAccess: "channel",
          allowedUsers: new Set(),
          allowedChannels: new Set(),
          botUserId: null,
        }),
      ),
    );
  });
});

describe("stripBotMention", () => {
  it("removes every exact mention and preserves other Slack markup", () => {
    assert.equal(stripBotMention(`<@${BOT_ID}> compare <@U_OTHER> with <@${BOT_ID}> this`, BOT_ID), "compare <@U_OTHER> with  this");
  });

  it("does not remove partial or different user mentions", () => {
    assert.equal(stripBotMention(`<@${BOT_ID}2> hello`, BOT_ID), `<@${BOT_ID}2> hello`);
  });
});

describe("decideMessage — structural rejection", () => {
  const cases: [string, SlackMessageEvent, string][] = [
    ["message subtypes", event({ subtype: "message_changed" }), "message-subtype"],
    ["bot messages", event({ bot_id: "B123" }), "bot-message"],
    ["missing users", event({ user: undefined }), "missing-user"],
    ["the bridge bot itself", event({ user: BOT_ID }), "self-message"],
    ["missing channels", event({ channel: undefined }), "missing-channel"],
    ["empty text", event({ text: "   " }), "empty-text"],
  ];

  for (const [label, input, reason] of cases) {
    it(`rejects ${label}`, () => {
      assert.deepEqual(decideMessage(input, config()).kind, "ignore");
      assert.equal((decideMessage(input, config()) as { reason: string }).reason, reason);
    });
  }
});

describe("decideMessage — access matrix", () => {
  it("accepts an allowed user in an allowed shared channel", () => {
    assert.deepEqual(decideMessage(event(), config()), {
      kind: "accept",
      channelId: ALLOWED_CHANNEL,
      userId: ALLOWED_USER,
      text: "summarize this",
    });
  });

  it("rejects an unlisted user even in an allowed channel", () => {
    assert.equal((decideMessage(event({ user: "U_DENIED" }), config()) as { reason: string }).reason, "user-not-allowed");
  });

  it("rejects an allowed user in an unlisted shared channel", () => {
    assert.equal((decideMessage(event({ channel: "C_DENIED" }), config()) as { reason: string }).reason, "channel-not-allowed");
  });

  it("allows a listed user's DM without listing its D-channel in user mode", () => {
    assert.equal(decideMessage(event({ channel: "D_DYNAMIC", channel_type: "im" }), config()).kind, "accept");
  });

  it("retains legacy D-channel filtering in channel mode", () => {
    const decision = decideMessage(event({ channel: "D_DYNAMIC", channel_type: "im" }), config({ dmAccess: "channel" }));
    assert.equal((decision as { reason: string }).reason, "channel-not-allowed");
  });

  it("fails closed for user-mode DMs when the user allowlist is empty", () => {
    const decision = decideMessage(event({ channel: "D_DYNAMIC", channel_type: "im" }), config({ allowedUsers: new Set() }));
    assert.equal((decision as { reason: string }).reason, "dm-user-allowlist-empty");
  });
});

describe("decideMessage — invocation mode", () => {
  it("requires an exact bot mention in channels and threads", () => {
    const decision = decideMessage(event({ text: "summarize this", thread_ts: "1799999999.000000" }), config());
    assert.equal((decision as { reason: string }).reason, "mention-required");
  });

  it("requires an exact bot mention in DMs too", () => {
    const decision = decideMessage(event({ channel: "D_DYNAMIC", channel_type: "im", text: "hello" }), config());
    assert.equal((decision as { reason: string }).reason, "mention-required");
  });

  it("rejects a partial mention", () => {
    const decision = decideMessage(event({ text: `<@${BOT_ID}2> hello` }), config());
    assert.equal((decision as { reason: string }).reason, "mention-required");
  });

  it("returns a local usage response for mention-only text", () => {
    assert.deepEqual(decideMessage(event({ text: `  <@${BOT_ID}>  ` }), config()), {
      kind: "usage",
      channelId: ALLOWED_CHANNEL,
      userId: ALLOWED_USER,
    });
  });

  it("preserves legacy text in all mode without requiring a mention", () => {
    const text = "  summarize this  ";
    assert.deepEqual(decideMessage(event({ text }), config({ invocationMode: "all" })), {
      kind: "accept",
      channelId: ALLOWED_CHANNEL,
      userId: ALLOWED_USER,
      text,
    });
  });

  it("fails closed if mention mode somehow runs without a bot identity", () => {
    const decision = decideMessage(event(), config({ botUserId: null }));
    assert.equal((decision as { reason: string }).reason, "bot-identity-unavailable");
  });
});
