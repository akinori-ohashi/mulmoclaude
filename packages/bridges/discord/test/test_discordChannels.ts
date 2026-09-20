// The helpers in `sessionId.ts` rest on claims about a library we do not own:
// that `parentId` names the parent CATEGORY on a guild channel but the parent
// TEXT/FORUM channel on a thread, and that a forum channel cannot be posted
// to. `test_sessionId.ts` exercises the helpers against hand-written doubles,
// which pins our logic but would keep passing if discord.js changed those
// claims under us.
//
// So this file builds REAL discord.js channel objects from raw gateway
// payloads and reads the properties off them.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Client, GatewayIntentBits, type ForumChannel, type TextChannel, type ThreadChannel } from "discord.js";
import { buildExternalChatId, isChannelAllowed, readChannelRef, type SessionGranularity } from "../src/sessionId.ts";

const GUILD_ID = "900000000000000000";
const CATEGORY_ID = "333333333333333333";
const TEXT_CHANNEL_ID = "111111111111111111";
const TEXT_THREAD_ID = "222222222222222222";
const FORUM_ID = "777777777777777777";
const FORUM_POST_ID = "888888888888888888";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
after(() => client.destroy());

/** discord.js exposes no public constructor for a channel. `_add` is the very
 *  method `Guild._patch` calls for each entry of a GUILD_CREATE payload, so
 *  this goes through the same door production does. Reached via a narrowing
 *  guard rather than a cast, and a rename upstream fails this file loudly —
 *  which is the signal we want out of a discord.js upgrade. */
interface ChannelAdder {
  _add: (data: Record<string, unknown>, guild: unknown, options: { cache: boolean }) => unknown;
}
const isChannelAdder = (value: unknown): value is ChannelAdder =>
  typeof value === "object" && value !== null && "_add" in value && typeof value._add === "function";

// Deliberately typed `unknown`: narrowing the manager's own declared type
// would intersect with a PRIVATE `_add` and collapse to `never`.
const channelManager: unknown = client.channels;

const guildStub = {
  id: GUILD_ID,
  client,
  shardId: 0,
  channels: { cache: new Map<string, unknown>(), resolve: (channelId: string) => client.channels.cache.get(channelId) ?? null },
};

const addChannel = (raw: Record<string, unknown>): void => {
  assert.ok(isChannelAdder(channelManager), "discord.js ChannelManager no longer exposes _add — this file needs updating");
  channelManager._add({ guild_id: GUILD_ID, ...raw }, guildStub, { cache: true });
};

addChannel({ id: CATEGORY_ID, type: ChannelType.GuildCategory, name: "assistants" });
addChannel({ id: TEXT_CHANNEL_ID, type: ChannelType.GuildText, name: "ai-help", parent_id: CATEGORY_ID });
addChannel({ id: TEXT_THREAD_ID, type: ChannelType.PublicThread, name: "deploy question", parent_id: TEXT_CHANNEL_ID });
addChannel({ id: FORUM_ID, type: ChannelType.GuildForum, name: "help-forum", available_tags: [] });
addChannel({ id: FORUM_POST_ID, type: ChannelType.PublicThread, name: "how do I…", parent_id: FORUM_ID });

/** Fetch a cached channel and narrow it with discord.js's OWN predicates, so
 *  the test reads the real declared types rather than asserting its way past
 *  them. */
const cachedThread = (channelId: string): ThreadChannel => {
  const channel = client.channels.cache.get(channelId);
  assert.ok(channel?.isThread(), `${channelId} should be cached as a thread`);
  return channel;
};
const cachedTextChannel = (channelId: string): TextChannel => {
  const channel = client.channels.cache.get(channelId);
  assert.ok(channel !== undefined && channel.type === ChannelType.GuildText, `${channelId} should be cached as a text channel`);
  return channel;
};
const cachedForum = (channelId: string): ForumChannel => {
  const channel = client.channels.cache.get(channelId);
  assert.ok(channel !== undefined && channel.type === ChannelType.GuildForum, `${channelId} should be cached as a forum`);
  return channel;
};

const textChannel = cachedTextChannel(TEXT_CHANNEL_ID);
const textThread = cachedThread(TEXT_THREAD_ID);
const forum = cachedForum(FORUM_ID);
const forumPost = cachedThread(FORUM_POST_ID);

/** The exact guard `onPushEvent` applies before sending to a resolved channel.
 *  A session id that fails this is one the server can never push a reply into. */
const passesPushGuard = (channelId: string): boolean => {
  const channel = client.channels.cache.get(channelId);
  return channel !== undefined && channel.isTextBased() && channel.isSendable();
};

describe("discord.js still means what sessionId.ts assumes", () => {
  it("a guild text channel reports its CATEGORY as parentId", () => {
    assert.equal(textChannel.isThread(), false);
    assert.equal(textChannel.parentId, CATEGORY_ID);
  });

  it("a thread reports its parent TEXT CHANNEL as parentId", () => {
    assert.equal(textThread.parentId, TEXT_CHANNEL_ID);
  });

  it("a forum post is a thread whose parent is the forum", () => {
    assert.equal(forumPost.parentId, FORUM_ID);
  });

  it("a forum channel can neither be posted to nor treated as text-based", () => {
    assert.equal(forum.isSendable(), false);
    assert.equal(forum.isTextBased(), false);
  });

  it("a text channel, a thread and a forum post can all be posted to", () => {
    assert.equal(textChannel.isSendable(), true);
    assert.equal(textThread.isSendable(), true);
    assert.equal(forumPost.isSendable(), true);
  });

  it("a thread resolves its parent from the channel cache, which is how sendability is read", () => {
    assert.equal(textThread.parent?.isSendable(), true);
    assert.equal(forumPost.parent?.isSendable(), false);
  });
});

describe("readChannelRef over real channels", () => {
  it("never exposes a category as the parent", () => {
    assert.deepEqual(readChannelRef(TEXT_CHANNEL_ID, textChannel), { channelId: TEXT_CHANNEL_ID });
  });

  it("exposes a thread's parent text channel, marked sendable", () => {
    assert.deepEqual(readChannelRef(TEXT_THREAD_ID, textThread), {
      channelId: TEXT_THREAD_ID,
      parentChannel: { id: TEXT_CHANNEL_ID, sendable: true },
    });
  });

  it("exposes a forum post's forum, marked not sendable", () => {
    assert.deepEqual(readChannelRef(FORUM_POST_ID, forumPost), {
      channelId: FORUM_POST_ID,
      parentChannel: { id: FORUM_ID, sendable: false },
    });
  });
});

describe("allowlist decisions over real channels", () => {
  it("a listed category admits nothing beneath it", () => {
    const allowed = new Set([CATEGORY_ID]);
    assert.equal(isChannelAllowed(readChannelRef(TEXT_CHANNEL_ID, textChannel), allowed), false);
    assert.equal(isChannelAllowed(readChannelRef(TEXT_THREAD_ID, textThread), allowed), false);
  });

  it("a listed text channel admits its threads", () => {
    assert.equal(isChannelAllowed(readChannelRef(TEXT_THREAD_ID, textThread), new Set([TEXT_CHANNEL_ID])), true);
  });

  it("a listed forum admits its posts, unsendable though the forum is", () => {
    assert.equal(isChannelAllowed(readChannelRef(FORUM_POST_ID, forumPost), new Set([FORUM_ID])), true);
  });

  it("a listed text channel does not admit an unrelated forum post", () => {
    assert.equal(isChannelAllowed(readChannelRef(FORUM_POST_ID, forumPost), new Set([TEXT_CHANNEL_ID])), false);
  });
});

// The property that matters and that the pure-helper tests cannot state: a
// session id is only useful if the server can push a reply back into it. This
// is the invariant the forum case broke.
describe("every session id we can produce is one onPushEvent can deliver to", () => {
  const everyMode: SessionGranularity[] = ["thread", "channel"];
  const everyChannel: [string, string, Parameters<typeof readChannelRef>[1]][] = [
    ["text channel", TEXT_CHANNEL_ID, textChannel],
    ["thread", TEXT_THREAD_ID, textThread],
    ["forum post", FORUM_POST_ID, forumPost],
  ];

  everyChannel.forEach(([label, channelId, channel]) => {
    everyMode.forEach((mode) => {
      it(`${label} in ${mode} mode`, () => {
        const sessionId = buildExternalChatId(readChannelRef(channelId, channel), mode);
        assert.equal(passesPushGuard(sessionId), true, `session id ${sessionId} cannot receive a push`);
      });
    });
  });

  it("and the guard really does reject a forum and a category, so the assertions above are not vacuous", () => {
    assert.equal(passesPushGuard(FORUM_ID), false);
    assert.equal(passesPushGuard(CATEGORY_ID), false);
  });
});
