// Whether a session id is safe to turn into a file path.
//
// It lives beside the IO that needs it rather than with any one caller: every
// route param, bridge handshake and index scan ends up at the same
// `path.join(dir, `${id}.json`)`, and `metaRel` normalises `../` away, so one
// unvalidated id reaches any file under the workspace. `readTextUnder` is
// documented as "internal fixed paths only, no traversal guard" — this is the
// rule that keeps that contract true.

/** Character-class + length bound. `\w` covers UUIDs (`randomUUID()`)
 *  and the transport-chat-timestamp triples chat-state emits for fresh
 *  bridge chats; `.` and `-` cover the separator variants used in the
 *  wild. `/` and `\` are excluded, so single-dot / single-hyphen
 *  separators are fine but a whole-string `..` slips through this
 *  check alone — `isSafeSessionId` rejects `..` sequences as a second
 *  gate. Exported for direct unit testing. */
export const SAFE_SESSION_ID_RE = /^[\w.-]{1,200}$/;

/** True iff `sessionId` is safe to hand to a session-file reader or writer.
 *  Combines the character-class regex with an explicit `..` rejection —
 *  otherwise a literal `..` (or `foo..bar`) would pass the class check and let
 *  `path.join(dir, "..json")` escape the CHAT dir. */
export function isSafeSessionId(sessionId: string): boolean {
  if (!SAFE_SESSION_ID_RE.test(sessionId)) return false;
  if (sessionId.includes("..")) return false;
  return true;
}
