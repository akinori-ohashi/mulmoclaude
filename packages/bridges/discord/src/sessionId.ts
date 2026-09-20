// Session-granularity helpers for @mulmobridge/discord.
//
// Kept separate from index.ts so they can be unit-tested without
// importing the bridge entrypoint (which opens a Gateway connection on
// load).

export type SessionGranularity = "channel" | "thread";

/** Where a Discord message arrived.
 *
 *  A Discord thread IS a channel — it carries its own snowflake, which is
 *  what `Message.channelId` holds. `parentChannelId` is therefore set only
 *  for threads, and always names the text/forum channel the thread hangs
 *  off, never a category. */
export interface MessageChannelRef {
  channelId: string;
  parentChannelId?: string;
}

/** The slice of `Message.channel` read here. `parentId` is optional because
 *  a DM channel has no such property at all. */
interface ChannelLike {
  isThread: () => boolean;
  parentId?: string | null;
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
 *  keying. */
export function readChannelRef(channelId: string, channel: ChannelLike): MessageChannelRef {
  if (!channel.isThread()) return { channelId };
  const parentChannelId = channel.parentId ?? undefined;
  return parentChannelId === undefined ? { channelId } : { channelId, parentChannelId };
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
  return ref.parentChannelId !== undefined && allowedChannels.has(ref.parentChannelId);
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
 *  names a thread or a text channel. */
export function buildExternalChatId(ref: MessageChannelRef, mode: SessionGranularity): string {
  if (mode === "thread") return ref.channelId;
  return ref.parentChannelId ?? ref.channelId;
}
