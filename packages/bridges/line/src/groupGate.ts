// Whether the bridge answers a message from a group / room. Pure.

import type { LineChatType } from "./parse.js";

const TRUE_VALUES = new Set(["", "1", "true"]);
const FALSE_VALUES = new Set(["0", "false"]);

/** LINE_BRIDGE_GROUP_REQUIRE_MENTION: unset / `1` / `true` → on (the default),
 *  `0` / `false` → off. Anything else throws so a typo can't silently flip it. */
export function parseRequireMention(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new Error(`Invalid LINE_BRIDGE_GROUP_REQUIRE_MENTION=${JSON.stringify(raw)}. Expected 1 or 0.`);
}

/** The bot receives every message in a group, so there it answers only when mentioned
 *  unless the gate is off. One-on-one chats are always answered. */
export function shouldRespond(incoming: { chatType: LineChatType; mentionsBot: boolean }, requireMention: boolean): boolean {
  if (incoming.chatType === "user") return true;
  return !requireMention || incoming.mentionsBot;
}
