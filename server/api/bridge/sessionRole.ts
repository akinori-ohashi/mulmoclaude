import { isSafeSessionId } from "../../utils/files/sessionId.js";

// Session-id-safe wrapper for the `getSessionRole` DI the chat-service
// package exposes to the HTTP `/connect` route. Extracted from server/index.ts
// so the hostile-input + IO-error semantics can be pinned in a focused test
// (codex review on #1895).

/** Read one session's `roleId` for the HTTP `/connect` role-resolver
 *  path. The `sessionId` MUST NOT be handed to the underlying reader
 *  unvalidated — see `readTextUnder`'s "internal fixed paths only, no
 *  `..` traversal guard" contract. Returns null in three cases, all
 *  treated by the route as "preserve the previous role":
 *
 *    1. `sessionId` fails the safe-id shape check (hostile input).
 *    2. Metadata is absent or corrupt (the reader itself returns null).
 *    3. Any unexpected IO error (permission denied, disk error). Left
 *       unwrapped, `rethrowUnexpected` inside the reader would surface
 *       as a 500 from the `/connect` handler — that's a hostile-input
 *       surface too, so degrade to null instead. */
export async function resolveBridgeSessionRole(
  sessionId: string,
  readMeta: (id: string) => Promise<{ roleId?: string | undefined } | null>,
): Promise<string | null> {
  if (!isSafeSessionId(sessionId)) return null;
  try {
    const meta = await readMeta(sessionId);
    return meta?.roleId ?? null;
  } catch {
    return null;
  }
}
