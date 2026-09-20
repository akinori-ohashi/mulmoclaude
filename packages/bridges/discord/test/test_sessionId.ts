import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExternalChatId, isChannelAllowed, parseGranularity, readChannelRef } from "../src/sessionId.ts";

// Real-shaped snowflakes so a reader can tell the three roles apart.
const PARENT_CHANNEL = "111111111111111111";
const THREAD = "222222222222222222";
const CATEGORY = "333333333333333333";
const DM_CHANNEL = "444444444444444444";
const OTHER_CHANNEL = "555555555555555555";
const FORUM = "777777777777777777";

/** A thread under a text channel: `parentId` is the parent TEXT channel, and
 *  that parent is a place messages can be posted. */
const threadChannel = (parentId: string | null) => ({
  isThread: () => true,
  parentId,
  parent: parentId === null ? null : { isSendable: () => true },
});
/** A forum post. Also a thread, but its parent is a ForumChannel, which
 *  discord.js reports as NOT sendable — you open a post, you do not post to
 *  the forum itself. */
const forumPost = (parentId: string) => ({ isThread: () => true, parentId, parent: { isSendable: () => false } });
/** A thread whose parent is not in the channel cache, so its kind is unknown. */
const threadWithUncachedParent = (parentId: string) => ({ isThread: () => true, parentId, parent: null });
/** A plain guild text channel: `parentId` is the CATEGORY it sits in. */
const guildTextChannel = (categoryId: string | null) => ({ isThread: () => false, parentId: categoryId });
/** A DM channel has neither `parentId` nor `parent`. */
const dmChannel = () => ({ isThread: () => false });

describe("parseGranularity", () => {
  it("defaults to 'thread' when the env var is unset — today's behaviour", () => {
    assert.equal(parseGranularity(undefined), "thread");
  });
  it("accepts 'thread'", () => {
    assert.equal(parseGranularity("thread"), "thread");
  });
  it("accepts 'channel'", () => {
    assert.equal(parseGranularity("channel"), "channel");
  });
  it("is case-insensitive", () => {
    assert.equal(parseGranularity("THREAD"), "thread");
    assert.equal(parseGranularity("Channel"), "channel");
  });
  it("throws on an unknown value instead of falling back", () => {
    assert.throws(() => parseGranularity("topic"), /Invalid DISCORD_SESSION_GRANULARITY/);
  });
  it("throws on an empty string", () => {
    assert.throws(() => parseGranularity(""), /Invalid DISCORD_SESSION_GRANULARITY/);
  });
  it("throws on surrounding whitespace instead of trimming it away", () => {
    assert.throws(() => parseGranularity(" thread"), /Invalid DISCORD_SESSION_GRANULARITY/);
    assert.throws(() => parseGranularity("channel "), /Invalid DISCORD_SESSION_GRANULARITY/);
  });
  it("rejects Slack's 'auto', which has no distinct meaning on Discord", () => {
    assert.throws(() => parseGranularity("auto"), /Invalid DISCORD_SESSION_GRANULARITY/);
  });
});

describe("readChannelRef", () => {
  it("a thread carries its parent text channel, marked sendable", () => {
    assert.deepEqual(readChannelRef(THREAD, threadChannel(PARENT_CHANNEL)), {
      channelId: THREAD,
      parentChannel: { id: PARENT_CHANNEL, sendable: true },
    });
  });

  it("a forum post carries its forum, marked NOT sendable", () => {
    assert.deepEqual(readChannelRef(THREAD, forumPost(FORUM)), {
      channelId: THREAD,
      parentChannel: { id: FORUM, sendable: false },
    });
  });

  it("defensive: an uncached parent reads as not sendable rather than throwing", () => {
    assert.deepEqual(readChannelRef(THREAD, threadWithUncachedParent(PARENT_CHANNEL)), {
      channelId: THREAD,
      parentChannel: { id: PARENT_CHANNEL, sendable: false },
    });
  });

  // The whole reason the isThread() gate exists: on a GuildChannel, parentId
  // is the CATEGORY id. Letting it through would allow-check and key sessions
  // against a category.
  it("a plain text channel does NOT expose its category as a parent", () => {
    assert.deepEqual(readChannelRef(OTHER_CHANNEL, guildTextChannel(CATEGORY)), { channelId: OTHER_CHANNEL });
  });

  it("a text channel with no category is still parentless", () => {
    assert.deepEqual(readChannelRef(OTHER_CHANNEL, guildTextChannel(null)), { channelId: OTHER_CHANNEL });
  });

  it("a DM channel, which has no parentId property at all", () => {
    assert.deepEqual(readChannelRef(DM_CHANNEL, dmChannel()), { channelId: DM_CHANNEL });
  });

  it("a thread whose parent is null omits parentChannel rather than storing null", () => {
    assert.deepEqual(readChannelRef(THREAD, threadChannel(null)), { channelId: THREAD });
  });
});

describe("isChannelAllowed", () => {
  it("an empty allowlist admits everything", () => {
    const allowNone = new Set<string>();
    assert.equal(isChannelAllowed({ channelId: OTHER_CHANNEL }, allowNone), true);
    assert.equal(isChannelAllowed({ channelId: THREAD, parentChannel: { id: PARENT_CHANNEL, sendable: true } }, allowNone), true);
  });

  it("admits a thread whose PARENT is listed — the point of #3217", () => {
    const allowed = new Set([PARENT_CHANNEL]);
    assert.equal(isChannelAllowed({ channelId: THREAD, parentChannel: { id: PARENT_CHANNEL, sendable: true } }, allowed), true);
  });

  it("still admits a thread listed by its OWN id — the pre-existing .env workaround", () => {
    const allowed = new Set([THREAD]);
    assert.equal(isChannelAllowed({ channelId: THREAD, parentChannel: { id: PARENT_CHANNEL, sendable: true } }, allowed), true);
  });

  it("denies a thread when neither it nor its parent is listed", () => {
    const allowed = new Set([OTHER_CHANNEL]);
    assert.equal(isChannelAllowed({ channelId: THREAD, parentChannel: { id: PARENT_CHANNEL, sendable: true } }, allowed), false);
  });

  it("admits a plain channel that is listed", () => {
    assert.equal(isChannelAllowed({ channelId: OTHER_CHANNEL }, new Set([OTHER_CHANNEL])), true);
  });

  it("denies a plain channel that is not listed", () => {
    assert.equal(isChannelAllowed({ channelId: OTHER_CHANNEL }, new Set([PARENT_CHANNEL])), false);
  });

  it("a listed CATEGORY does not admit a channel inside it", () => {
    const ref = readChannelRef(OTHER_CHANNEL, guildTextChannel(CATEGORY));
    assert.equal(isChannelAllowed(ref, new Set([CATEGORY])), false);
  });

  it("a DM is denied by a non-empty allowlist that does not name it", () => {
    assert.equal(isChannelAllowed({ channelId: DM_CHANNEL }, new Set([PARENT_CHANNEL])), false);
  });

  // A forum channel is a fine allowlist entry even though nothing can be
  // posted to it — the allow decision is about the id, not about sendability.
  it("a forum post is admitted by its FORUM id, unsendable though that channel is", () => {
    const ref = readChannelRef(THREAD, forumPost(FORUM));
    assert.equal(isChannelAllowed(ref, new Set([FORUM])), true);
  });
});

describe("buildExternalChatId", () => {
  const inThread = { channelId: THREAD, parentChannel: { id: PARENT_CHANNEL, sendable: true } };
  const notInThread = { channelId: OTHER_CHANNEL };

  it("thread mode: a thread keys its own session", () => {
    assert.equal(buildExternalChatId(inThread, "thread"), THREAD);
  });

  it("thread mode: a non-thread message keys the channel", () => {
    assert.equal(buildExternalChatId(notInThread, "thread"), OTHER_CHANNEL);
  });

  it("channel mode: a thread folds into its parent channel", () => {
    assert.equal(buildExternalChatId(inThread, "channel"), PARENT_CHANNEL);
  });

  it("channel mode: a non-thread message keys the channel", () => {
    assert.equal(buildExternalChatId(notInThread, "channel"), OTHER_CHANNEL);
  });

  it("channel mode: a parentless thread falls back to its own id rather than producing nothing", () => {
    assert.equal(buildExternalChatId({ channelId: THREAD }, "channel"), THREAD);
  });

  // Keying a session by a forum id would strand every server-initiated push:
  // onPushEvent drops a target that is not `isTextBased() && isSendable()`,
  // and a ForumChannel is neither.
  it("channel mode: a forum post does NOT fold onto its unsendable forum", () => {
    const ref = readChannelRef(THREAD, forumPost(FORUM));
    assert.equal(buildExternalChatId(ref, "channel"), THREAD);
  });

  it("defensive: an uncached parent keeps the thread's own, deliverable id rather than risking a forum", () => {
    const ref = readChannelRef(THREAD, threadWithUncachedParent(PARENT_CHANNEL));
    assert.equal(buildExternalChatId(ref, "channel"), THREAD);
  });

  it("thread mode: a forum post keys its own session, as every thread does", () => {
    const ref = readChannelRef(THREAD, forumPost(FORUM));
    assert.equal(buildExternalChatId(ref, "thread"), THREAD);
  });

  it("the two modes agree whenever the message is not in a thread", () => {
    assert.equal(buildExternalChatId(notInThread, "thread"), buildExternalChatId(notInThread, "channel"));
  });
});

describe("end to end over a message's channel object", () => {
  const allowed = new Set([PARENT_CHANNEL]);

  it("a thread under an allowed channel: admitted, own session by default", () => {
    const ref = readChannelRef(THREAD, threadChannel(PARENT_CHANNEL));
    assert.equal(isChannelAllowed(ref, allowed), true);
    assert.equal(buildExternalChatId(ref, parseGranularity(undefined)), THREAD);
  });

  it("the same thread under DISCORD_SESSION_GRANULARITY=channel: admitted, parent's session", () => {
    const ref = readChannelRef(THREAD, threadChannel(PARENT_CHANNEL));
    assert.equal(buildExternalChatId(ref, parseGranularity("channel")), PARENT_CHANNEL);
  });

  it("a thread under a channel that is NOT allowed stays denied", () => {
    const ref = readChannelRef(THREAD, threadChannel(OTHER_CHANNEL));
    assert.equal(isChannelAllowed(ref, allowed), false);
  });
});
