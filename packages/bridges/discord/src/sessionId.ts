// Session-granularity helpers for @mulmobridge/discord.
//
// Kept separate from index.ts so they can be unit-tested without
// importing the bridge entrypoint (which opens a Gateway connection on
// load).

export type SessionGranularity = "channel" | "thread";

/** Where a Discord message arrived.
 *
 *  A Discord thread IS a channel — it carries its own snowflake, which is
 *  what `Message.channelId` holds. `parentChannel` is therefore present only
 *  for threads, and always names the text/forum channel the thread hangs
 *  off, never a category.
 *
 *  `sendable` travels with the id because the two are only ever useful
 *  together: a forum channel is a legitimate allowlist entry but not a place
 *  a message can be posted, so folding a session onto it would strand the
 *  reply. Pairing them makes it impossible to record the id without saying
 *  which kind it is. */
export interface MessageChannelRef {
  channelId: string;
  parentChannel?: { id: string; sendable: boolean };
}

/** The slice of `Message.channel` read here. Both parent fields are optional
 *  because a DM channel has neither. */
interface ChannelLike {
  isThread: () => boolean;
  parentId?: string | null;
  parent?: { isSendable: () => boolean } | null;
}

/** Parse the DISCORD_SESSION_GRANULARITY env var into a safe enum value.
 *
 *  Unset falls back to "thread", which is what the bridge has always done:
 *  it passes `msg.channelId` straight through, and for a message in a
 *  thread that id IS the thread's. Any explicit invalid value is rejected
 *  so operators notice the misconfiguration instead of silently getting
 *  some other mode. */
export function parseGranularity(raw: string | undefined): SessionGranularity {
  const normalised = (raw ?? "thread").toLowerCase();
  if (normalised === "channel" || normalised === "thread") {
    return normalised;
  }
  throw new Error(`Invalid DISCORD_SESSION_GRANULARITY=${JSON.stringify(raw)}. Expected one of: channel, thread.`);
}

/** Read the channel/parent pair off an incoming message.
 *
 *  The `isThread()` gate is load-bearing rather than defensive: on a
 *  `GuildChannel`, `parentId` is the id of the CATEGORY the channel sits
 *  in, while on a `ThreadChannel` it is the parent text channel. Reading it
 *  ungated would hand a category id to the allowlist and to session
 *  keying.
 *
 *  An uncached parent reads as not sendable. Unreachable as the bridge is
 *  configured — `Guild._patch` caches every channel in the GUILD_CREATE
 *  payload and the `Guilds` intent is always on — so this is only about which
 *  way a defensive branch fails. Not folding costs an extra session, which a
 *  user can see; folding onto a parent that turns out to be a forum costs the
 *  reply, which nobody sees. It never touches the allow decision, which runs
 *  off the id alone. */
export function readChannelRef(channelId: string, channel: ChannelLike): MessageChannelRef {
  if (!channel.isThread()) return { channelId };
  const parentId = channel.parentId ?? undefined;
  if (parentId === undefined) return { channelId };
  return { channelId, parentChannel: { id: parentId, sendable: channel.parent?.isSendable() === true } };
}

/** Is this message's channel covered by DISCORD_ALLOWED_CHANNELS?
 *
 *  An empty allowlist is the "allow all" sentinel. A thread is admitted by
 *  its PARENT channel, which is the point: thread ids are minted fresh for
 *  every thread, so listing them is not an operable allowlist.
 *
 *  The channel's own id still counts. For a thread that is the pre-existing
 *  workaround — paste the thread id into `.env` and restart — and dropping
 *  it would be a regression. */
export function isChannelAllowed(ref: MessageChannelRef, allowedChannels: ReadonlySet<string>): boolean {
  if (allowedChannels.size === 0) return true;
  if (allowedChannels.has(ref.channelId)) return true;
  return ref.parentChannel !== undefined && allowedChannels.has(ref.parentChannel.id);
}

/** The externalChatId the server keys a session by. Two messages with
 *  different ids get independent sessions.
 *
 *  - "thread" → the channel's own id, so a thread is its own conversation.
 *  - "channel" → the parent channel for a thread, folding every thread
 *    under a channel into that channel's one conversation.
 *
 *  Both are plain snowflakes, so the push path needs no reverse parse: the
 *  id the server hands back resolves through `channels.fetch()` whether it
 *  names a thread or a text channel.
 *
 *  A thread under a FORUM never folds, whatever the mode. A forum channel
 *  cannot be posted to — `isSendable()` is false — so its id would key a
 *  session the server can never push a reply into, and the reply would be
 *  dropped by the push guard with only a warn line. A forum post is its own
 *  conversation anyway; there is no channel-level talk to fold it into. */
export function buildExternalChatId(ref: MessageChannelRef, mode: SessionGranularity): string {
  if (mode === "thread") return ref.channelId;
  return ref.parentChannel?.sendable === true ? ref.parentChannel.id : ref.channelId;
}
