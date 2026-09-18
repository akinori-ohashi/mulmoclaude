// Pure inbound-message policy for @mulmobridge/slack.
//
// Keeping access checks and mention stripping out of index.ts makes the
// security boundary testable without importing the Socket Mode entrypoint
// (which establishes network connections as a module side effect).

export type InvocationMode = "all" | "mention";
export type DmAccess = "channel" | "user";

export interface SlackMessageEvent {
  subtype?: unknown;
  bot_id?: unknown;
  user?: unknown;
  channel?: unknown;
  text?: unknown;
  ts?: unknown;
  thread_ts?: unknown;
  channel_type?: unknown;
}

export interface MessagePolicyConfig {
  invocationMode: InvocationMode;
  dmAccess: DmAccess;
  allowedUsers: ReadonlySet<string>;
  allowedChannels: ReadonlySet<string>;
  botUserId: string | null;
}

export type IgnoreReason =
  | "message-subtype"
  | "bot-message"
  | "missing-user"
  | "self-message"
  | "missing-channel"
  | "empty-text"
  | "user-not-allowed"
  | "channel-not-allowed"
  | "dm-user-allowlist-empty"
  | "bot-identity-unavailable"
  | "mention-required";

export type MessageDecision =
  | { kind: "ignore"; reason: IgnoreReason; channelId?: string; userId?: string }
  | { kind: "usage"; channelId: string; userId: string }
  | { kind: "accept"; channelId: string; userId: string; text: string };

export function parseInvocationMode(raw: string | undefined): InvocationMode {
  const normalised = (raw ?? "all").toLowerCase();
  if (normalised === "all" || normalised === "mention") return normalised;
  throw new Error(`Invalid SLACK_INVOCATION_MODE=${JSON.stringify(raw)}. Expected one of: all, mention.`);
}

export function parseDmAccess(raw: string | undefined): DmAccess {
  const normalised = (raw ?? "channel").toLowerCase();
  if (normalised === "channel" || normalised === "user") return normalised;
  throw new Error(`Invalid SLACK_DM_ACCESS=${JSON.stringify(raw)}. Expected one of: channel, user.`);
}

/** Validate startup-only invariants that depend on resolved Slack identity. */
export function validateMessagePolicyConfig(config: MessagePolicyConfig): void {
  if (config.invocationMode === "mention" && !config.botUserId) {
    throw new Error("SLACK_INVOCATION_MODE=mention requires auth.test to return the bot user ID.");
  }
  if (config.dmAccess === "user" && config.allowedUsers.size === 0) {
    throw new Error("SLACK_DM_ACCESS=user requires a non-empty SLACK_ALLOWED_USERS allowlist.");
  }
}

function exactMention(botUserId: string): string {
  return `<@${botUserId}>`;
}

/** Remove every exact mention of this bot, preserving all other Slack markup. */
export function stripBotMention(text: string, botUserId: string): string {
  return text.split(exactMention(botUserId)).join("").trim();
}

function ignored(reason: IgnoreReason, channelId?: string, userId?: string): MessageDecision {
  return {
    kind: "ignore",
    reason,
    ...(channelId ? { channelId } : {}),
    ...(userId ? { userId } : {}),
  };
}

interface ParsedMessage {
  kind: "parsed";
  channelId: string;
  userId: string;
  text: string;
  isDm: boolean;
}

function parseMessage(event: SlackMessageEvent, botUserId: string | null): ParsedMessage | MessageDecision {
  if (event.subtype) return ignored("message-subtype");
  if (event.bot_id) return ignored("bot-message");

  const userId = typeof event.user === "string" ? event.user.trim() : "";
  if (!userId) return ignored("missing-user");
  if (botUserId && userId === botUserId) return ignored("self-message", undefined, userId);

  const channelId = typeof event.channel === "string" ? event.channel.trim() : "";
  if (!channelId) return ignored("missing-channel", undefined, userId);

  const text = typeof event.text === "string" ? event.text : "";
  if (!text.trim()) return ignored("empty-text", channelId, userId);

  return { kind: "parsed", channelId, userId, text, isDm: event.channel_type === "im" };
}

function accessRejection(message: ParsedMessage, config: MessagePolicyConfig): MessageDecision | null {
  const { channelId, userId, isDm } = message;
  if (config.allowedUsers.size > 0 && !config.allowedUsers.has(userId)) {
    return ignored("user-not-allowed", channelId, userId);
  }

  if (isDm && config.dmAccess === "user" && config.allowedUsers.size === 0) {
    return ignored("dm-user-allowlist-empty", channelId, userId);
  }
  const mustMatchChannel = !isDm || config.dmAccess === "channel";
  if (mustMatchChannel && config.allowedChannels.size > 0 && !config.allowedChannels.has(channelId)) {
    return ignored("channel-not-allowed", channelId, userId);
  }
  return null;
}

function invocationDecision(message: ParsedMessage, config: MessagePolicyConfig): MessageDecision {
  const { channelId, userId, text } = message;
  if (config.invocationMode === "all") {
    return { kind: "accept", channelId, userId, text };
  }

  if (!config.botUserId) return ignored("bot-identity-unavailable", channelId, userId);
  const mention = exactMention(config.botUserId);
  if (!text.includes(mention)) return ignored("mention-required", channelId, userId);

  const prompt = stripBotMention(text, config.botUserId);
  if (!prompt) return { kind: "usage", channelId, userId };
  return { kind: "accept", channelId, userId, text: prompt };
}

/** Decide whether an inbound Slack message may reach MulmoClaude. */
export function decideMessage(event: SlackMessageEvent, config: MessagePolicyConfig): MessageDecision {
  const parsed = parseMessage(event, config.botUserId);
  if (parsed.kind !== "parsed") return parsed;
  const rejection = accessRejection(parsed, config);
  return rejection ?? invocationDecision(parsed, config);
}
