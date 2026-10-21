// Pure helpers for LINE's `message.mention` (group / room messages).

export interface LineMentionee {
  index: number;
  length: number;
  type?: string;
  userId?: string;
  isSelf?: boolean;
}

export interface LineMention {
  mentionees: LineMentionee[];
}

function isMentionee(value: unknown): value is LineMentionee {
  if (typeof value !== "object" || value === null) return false;
  if (!("index" in value) || !Number.isInteger(value.index)) return false;
  return "length" in value && Number.isInteger(value.length);
}

/** The bot's own mentions, or none when `mention` is absent or malformed — a broken
 *  field must read as "not mentioned", never reject the whole event. */
export function selfMentionees(mention: unknown): LineMentionee[] {
  if (typeof mention !== "object" || mention === null || !("mentionees" in mention)) return [];
  const { mentionees } = mention;
  if (!Array.isArray(mentionees)) return [];
  return mentionees.filter(isMentionee).filter((mentionee) => mentionee.isSelf === true);
}

export function mentionsBot(mention: unknown): boolean {
  return selfMentionees(mention).length > 0;
}

/** Remove the bot's own mention ranges from `text`. LINE's `index` / `length` count
 *  UTF-16 code units, the same unit as JS string offsets. Text with nothing to remove
 *  comes back untouched (no trim), so one-on-one messages are passed on verbatim. */
export function stripSelfMentions(text: string, mention: unknown): string {
  const inRange = selfMentionees(mention).filter(({ index, length }) => index >= 0 && length > 0 && index + length <= text.length);
  if (inRange.length === 0) return text;
  const removedOffsets = new Set(inRange.flatMap(({ index, length }) => Array.from({ length }, (_, step) => index + step)));
  // split("") yields UTF-16 code units, matching LINE's offsets; a mask also tolerates overlapping ranges.
  const kept = text.split("").filter((_, offset) => !removedOffsets.has(offset));
  return kept.join("").trim();
}
