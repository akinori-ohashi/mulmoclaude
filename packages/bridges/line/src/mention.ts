// Pure helpers for LINE's `message.mention` (group / room messages).

export interface LineMentionRange {
  index: number;
  length: number;
}

function isSelfMentionee(value: unknown): value is LineMentionRange {
  if (typeof value !== "object" || value === null) return false;
  if (!("isSelf" in value) || value.isSelf !== true) return false;
  if (!("index" in value) || !Number.isInteger(value.index)) return false;
  return "length" in value && Number.isInteger(value.length);
}

/** The bot's own mentions that actually lie inside `text`. LINE's `index` / `length`
 *  count UTF-16 code units, the same unit as JS string offsets. Absent, malformed or
 *  out-of-range data yields none, so it reads as "not mentioned" rather than rejecting
 *  the event — and the gate and the stripping always agree on what counts. */
export function selfMentionRanges(text: string, mention: unknown): LineMentionRange[] {
  if (typeof mention !== "object" || mention === null || !("mentionees" in mention)) return [];
  const { mentionees } = mention;
  if (!Array.isArray(mentionees)) return [];
  return mentionees
    .filter(isSelfMentionee)
    .filter(({ index, length }) => index >= 0 && length > 0 && index + length <= text.length)
    .map(({ index, length }) => ({ index, length }));
}

/** Remove `ranges` from `text` and trim. A mask (not slicing) so overlapping ranges are safe. */
export function stripMentionRanges(text: string, ranges: LineMentionRange[]): string {
  const removedOffsets = new Set(ranges.flatMap(({ index, length }) => Array.from({ length }, (_, step) => index + step)));
  const kept = text.split("").filter((_, offset) => !removedOffsets.has(offset));
  return kept.join("").trim();
}
