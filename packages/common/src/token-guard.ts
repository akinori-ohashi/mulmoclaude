// The bearer rule every surface applies to a presented secret, in one place
// so no tier re-types it: the host's `/api/*` middleware and view-token check,
// the `/ws/pubsub` and `/ws/chat` handshakes, and the shared-secret webhook
// bridge. Node-only (`node:crypto`), so it is its own subpath like `./ssrf`
// and is never reached from the browser-safe main entry.

import { timingSafeEqual } from "node:crypto";
import { isNonEmptyString } from "./index.js";

// Every bearer surface refuses with this one message, so neither a reply nor
// a log line says whether the token was missing or wrong.
export const UNAUTHORIZED_MESSAGE = "unauthorized";

// Constant-time comparison of a presented secret against the expected one.
// Byte lengths are compared first (not string lengths): `timingSafeEqual`
// throws on a buffer-length mismatch, so a candidate with the same character
// count but multi-byte characters would otherwise turn a refusal into a
// crash. The lengths are not secret, so the early return leaks nothing.
export function tokenEquals(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

// The one rule every guard applies to a presented token: the server must hold
// a token (it has none until bootstrap, and an empty one never authorizes),
// the candidate must be a non-empty string, and the two must match in
// constant time. `unknown` because a socket.io `auth` payload is client-shaped.
export function isAuthorizedToken(provided: unknown, expected: string | null): boolean {
  if (!isNonEmptyString(expected)) return false;
  if (!isNonEmptyString(provided)) return false;
  return tokenEquals(provided, expected);
}
