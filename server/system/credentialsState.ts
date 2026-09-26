import { isRecord } from "../utils/types.js";
import { ONE_MINUTE_MS } from "../utils/time.js";

/** Safety margin — treat tokens as expired 60s before actual expiry. */
const EXPIRY_MARGIN_MS = ONE_MINUTE_MS;

/** Every renewal launches a real, billed `claude` session, so a failing one is retried sparingly. */
export const RENEWAL_RETRY_COOLDOWN_MS = 5 * ONE_MINUTE_MS;
export const MAX_CONSECUTIVE_RENEWAL_FAILURES = 3;

export type CredentialsVerdict = { kind: "valid"; expiresMs: number } | { kind: "expired"; expiresMs: number | null } | { kind: "unusable"; reason: string };

export interface RenewalHistory {
  consecutiveFailures: number;
  lastFailureMs: number | null;
}

export type RenewalDecision = { kind: "attempt" } | { kind: "cooldown"; retryInMs: number } | { kind: "exhausted" };

export const NO_RENEWAL_FAILURES: RenewalHistory = { consecutiveFailures: 0, lastFailureMs: null };

function readOauth(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return isRecord(parsed.claudeAiOauth) ? parsed.claudeAiOauth : null;
}

/** The token's expiry as epoch milliseconds, or null when the JSON is
 *  unparseable or carries no usable expiry.
 *
 *  Claude's Keychain blob stores `expiresAt` as a number (epoch ms); older CLI
 *  builds wrote an ISO string. Accept both. A prior `typeof === "string"` guard
 *  silently rejected the numeric form, so every token read as "no expiry →
 *  expired" and forced a PTY renew of the CLI on every Docker run. */
export function readExpiresAt(raw: string): number | null {
  const expiresAt = readOauth(raw)?.expiresAt;
  if (typeof expiresAt === "number") return Number.isFinite(expiresAt) ? expiresAt : null;
  if (typeof expiresAt === "string") {
    const parsedMs = Date.parse(expiresAt);
    return Number.isNaN(parsedMs) ? null : parsedMs;
  }
  return null;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

/** Decide what the Keychain blob allows. Renewal is the CLI spending its
 *  refresh token, so without one no renewal can succeed and none is worth
 *  a billed session. */
export function classifyCredentials(raw: string, nowMs: number): CredentialsVerdict {
  const oauth = readOauth(raw);
  if (oauth === null) return { kind: "unusable", reason: "no claudeAiOauth block" };
  const expiresMs = readExpiresAt(raw);
  if (isNonEmptyString(oauth.accessToken) && expiresMs !== null && nowMs < expiresMs - EXPIRY_MARGIN_MS) return { kind: "valid", expiresMs };
  if (!isNonEmptyString(oauth.refreshToken)) return { kind: "unusable", reason: "the token needs renewing and the refresh token is empty" };
  return { kind: "expired", expiresMs };
}

export function renewalDecision(history: RenewalHistory, nowMs: number): RenewalDecision {
  if (history.consecutiveFailures >= MAX_CONSECUTIVE_RENEWAL_FAILURES) return { kind: "exhausted" };
  if (history.lastFailureMs === null) return { kind: "attempt" };
  const retryInMs = history.lastFailureMs + RENEWAL_RETRY_COOLDOWN_MS - nowMs;
  return retryInMs > 0 ? { kind: "cooldown", retryInMs } : { kind: "attempt" };
}

export function recordRenewal(history: RenewalHistory, succeeded: boolean, nowMs: number): RenewalHistory {
  if (succeeded) return NO_RENEWAL_FAILURES;
  return { consecutiveFailures: history.consecutiveFailures + 1, lastFailureMs: nowMs };
}
