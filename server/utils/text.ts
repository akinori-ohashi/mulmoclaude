// Shared text helpers. Use these instead of re-implementing the
// same operation per file (#1306).
//
// `truncate` lives in `@mulmoclaude/core/utils` so the host, the collection
// engine and the Google engine share one implementation — the copies had
// already drifted on the `ellipsis.length >= max` guard (#2217). Re-exported
// (rather than repointing ~5 import sites) to keep `server/utils/text.ts` the
// one place host code looks for general string helpers.
//
// Why not in `format/`: these are general string operations, not
// presentation-layer formatters. Reserve `format/` for locale-aware
// or unit-aware display helpers.
export { truncate } from "@mulmoclaude/core/utils";

/** Every Unicode control character: C0 (U+0000–U+001F), DEL (U+007F) and C1
 *  (U+0080–U+009F). The `Cc` property is the whole set — a hand-written
 *  `charCodeAt(0) <= 0x1f` cutoff looks equivalent and lets DEL and C1 pass,
 *  and C1 is the half that matters: U+009B is CSI, so a terminal reading a log
 *  line can act on it. */
const CONTROL_CHARACTER_RE = /\p{Cc}/u;

/** True when `value` holds a character that must not reach a log line, a
 *  terminal, or `process.env`.
 *
 *  Use this on anything that arrives from outside and is later typeset
 *  (a path handed over by the launcher, a secret pasted into Settings).
 *  Reject rather than strip: a control character in a value that should not
 *  have one means the value is wrong, and quietly repairing it hides that. */
export function hasControlCharacter(value: string): boolean {
  return CONTROL_CHARACTER_RE.test(value);
}
