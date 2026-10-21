// Pure parsing helpers for the LINE bridge webhook.

import { selfMentionRanges, stripMentionRanges } from "./mention.js";

export interface LineMessage {
  type: string;
  text?: string;
  /** LINE content id — present on media types (image / video / audio
   *  / file). The actual bytes live behind a separate Data API call
   *  (`/v2/bot/message/<id>/content`); the webhook only carries the
   *  reference. */
  id?: string;
  /** Present on group / room text messages that mention someone. Left unvalidated
   *  here: a malformed value reads as "not mentioned" (see mention.ts). */
  mention?: unknown;
}

export interface LineEventSource {
  type?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineEvent {
  type: string;
  replyToken?: string;
  source?: LineEventSource;
  message?: LineMessage;
}

export interface LineWebhookBody {
  events: LineEvent[];
}

export type LineChatType = "user" | "group" | "room";

/** Where the message came from: the conversation key and the push target. */
export interface LineChat {
  chatId: string;
  chatType: LineChatType;
}

/** Discriminated union — the webhook may surface text or media.
 *  Callers branch on `kind` and either send text straight to chat
 *  or download the media bytes via the LINE Data API.
 *
 *  PR-C of #1222: image is the only media kind we forward today.
 *  Video / audio / file extend this union if/when they become
 *  worth fanning out to the agent. */
export type IncomingLineMessage = LineChat & { mentionsBot: boolean } & ({ kind: "text"; text: string } | { kind: "image"; imageMessageId: string });

const nonEmpty = (value: string | undefined): value is string => typeof value === "string" && value.length > 0;

/** A group is one conversation keyed by `groupId`, a room by `roomId`. Anything else
 *  keys by `userId` exactly as before, so one-on-one sessions keep their ids. */
export function resolveLineChat(source: LineEventSource | undefined): LineChat | null {
  if (source?.type === "group") return nonEmpty(source.groupId) ? { chatId: source.groupId, chatType: "group" } : null;
  if (source?.type === "room") return nonEmpty(source.roomId) ? { chatId: source.roomId, chatType: "room" } : null;
  return nonEmpty(source?.userId) ? { chatId: source.userId, chatType: "user" } : null;
}

/** Text to relay and whether the bot was mentioned. Mentions are read only in groups /
 *  rooms: a one-on-one message is passed on verbatim, whatever it carries. */
function readText(chat: LineChat, message: LineMessage): { text: string; mentionsBot: boolean } {
  const raw = message.text ?? "";
  if (chat.chatType === "user") return { text: raw, mentionsBot: false };
  const ranges = selfMentionRanges(raw, message.mention);
  return ranges.length > 0 ? { text: stripMentionRanges(raw, ranges), mentionsBot: true } : { text: raw, mentionsBot: false };
}

/**
 * Reduce a LINE webhook event to the actionable shape. Returns null
 * for non-actionable events (non-message types, missing fields,
 * unsupported media). Pure — no side effects, no allowlist check.
 */
export function extractIncomingLineMessage(event: LineEvent): IncomingLineMessage | null {
  if (event.type !== "message") return null;
  const chat = resolveLineChat(event.source);
  if (!chat) return null;
  const { message } = event;
  if (!message) return null;
  if (message.type === "text") {
    const { text, mentionsBot } = readText(chat, message);
    if (!text.trim()) return null;
    return { ...chat, mentionsBot, kind: "text", text };
  }
  if (message.type === "image" && typeof message.id === "string" && message.id.length > 0) {
    return { ...chat, mentionsBot: false, kind: "image", imageMessageId: message.id };
  }
  return null;
}

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === "string";

function isLineEventSource(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("userId" in value && !isOptionalString(value.userId)) return false;
  if (!("type" in value)) return true;
  if (!isOptionalString(value.type)) return false;
  // Only the id the source type uses is checked: an unrelated extra field must not drop an event.
  if (value.type === "group") return !("groupId" in value) || isOptionalString(value.groupId);
  if (value.type === "room") return !("roomId" in value) || isOptionalString(value.roomId);
  return true;
}

function isLineMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || typeof value.type !== "string") return false;
  if ("text" in value && !isOptionalString(value.text)) return false;
  return !("id" in value) || isOptionalString(value.id);
}

/** True only when every field `LineEvent` declares is present in the shape it
 *  declares. Extra platform fields we don't model are left untouched. */
function isLineEvent(value: unknown): value is LineEvent {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || typeof value.type !== "string") return false;
  if ("replyToken" in value && !isOptionalString(value.replyToken)) return false;
  if ("source" in value && value.source !== undefined && !isLineEventSource(value.source)) return false;
  return !("message" in value) || value.message === undefined || isLineMessage(value.message);
}

/** Best-effort JSON parse for the webhook body — null on malformed input.
 *  Events that don't match `LineEvent` are dropped rather than handed on as if
 *  they did: a `null` element used to throw inside the delivery loop. */
export function parseLineWebhookBody(raw: string): LineWebhookBody | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("events" in parsed)) return null;
    const { events } = parsed;
    return Array.isArray(events) ? { events: events.filter(isLineEvent) } : null;
  } catch {
    return null;
  }
}
