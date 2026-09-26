// Tests for the pure helpers of `server/system/credentials.ts`.
// `looksLikeClaudeResponse` decides whether PTY output looks like a real Claude
// reply (conversational opener AND >= 20 chars) versus an error chunk that
// should time out. `readExpiresAt` narrows the Keychain blob to the token's
// expiry in epoch ms. `classifyCredentials` / `renewalDecision` decide whether a
// renewal — a billed `claude` session — is worth attempting at all.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { looksLikeClaudeResponse } from "../../server/system/credentials.js";
import {
  classifyCredentials,
  MAX_CONSECUTIVE_RENEWAL_FAILURES,
  NO_RENEWAL_FAILURES,
  readExpiresAt,
  recordRenewal,
  renewalDecision,
  RENEWAL_RETRY_COOLDOWN_MS,
} from "../../server/system/credentialsState.js";

describe("looksLikeClaudeResponse", () => {
  it("returns true for a conversational opener with enough text", () => {
    assert.equal(looksLikeClaudeResponse("Hello! How can I help you today?"), true);
  });

  it("returns true for an `I'm` opener (straight apostrophe) past the length floor", () => {
    assert.equal(looksLikeClaudeResponse("I'm here to help you out."), true);
  });

  it("returns true for an `I'm` opener (curly apostrophe) past the length floor", () => {
    assert.equal(looksLikeClaudeResponse("I’m ready to assist you now."), true);
  });

  it("returns false when the opener matches but the text is too short (< 20 chars)", () => {
    assert.equal(looksLikeClaudeResponse("Hi there"), false);
  });

  it("returns false at the boundary (exactly 19 chars, matching opener)", () => {
    const text = "Hi! short reply...."; // 19 chars, matches "Hi"
    assert.equal(text.length, 19);
    assert.equal(looksLikeClaudeResponse(text), false);
  });

  it("returns true at the boundary (exactly 20 chars, matching opener)", () => {
    const text = "Hi! twentycharsxxxxx"; // 20 chars, matches "Hi"
    assert.equal(text.length, 20);
    assert.equal(looksLikeClaudeResponse(text), true);
  });

  it("returns false for a login-error chunk", () => {
    assert.equal(looksLikeClaudeResponse("Please log in"), false);
  });

  it("returns false for an invalid-credentials chunk", () => {
    assert.equal(looksLikeClaudeResponse("Invalid credentials"), false);
  });

  it("returns false for long text without a conversational opener", () => {
    assert.equal(looksLikeClaudeResponse("Please log in to continue your session now."), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(looksLikeClaudeResponse(""), false);
  });
});

describe("readExpiresAt", () => {
  const wrap = (expiresAt: unknown) => JSON.stringify({ claudeAiOauth: { expiresAt } });

  it("returns the epoch-ms number when expiresAt is a number (the Keychain's real shape)", () => {
    // Regression: a `typeof === "string"` guard used to reject this, so a valid
    // token read as "no expiry → expired" and forced a renew on every run.
    assert.equal(readExpiresAt(wrap(1784602611420)), 1784602611420);
  });

  it("parses an ISO-8601 string expiresAt to epoch ms (legacy CLI shape)", () => {
    const iso = "2026-07-21T03:00:00.000Z";
    assert.equal(readExpiresAt(wrap(iso)), Date.parse(iso));
  });

  it("returns null when claudeAiOauth is absent", () => {
    assert.equal(readExpiresAt(JSON.stringify({ other: 1 })), null);
  });

  it("returns null when expiresAt is absent", () => {
    assert.equal(readExpiresAt(JSON.stringify({ claudeAiOauth: {} })), null);
  });

  it("returns null for a non-numeric, non-date string expiresAt", () => {
    assert.equal(readExpiresAt(wrap("not-a-date")), null);
  });

  it("returns null for a boolean expiresAt", () => {
    assert.equal(readExpiresAt(wrap(true)), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(readExpiresAt("{not json"), null);
  });

  it("returns null for a non-object top-level value", () => {
    assert.equal(readExpiresAt("42"), null);
    assert.equal(readExpiresAt("null"), null);
  });
});

const NOW_MS = Date.parse("2026-09-26T00:00:00Z");
const ONE_HOUR_MS = 3_600_000;

function blob(oauth: Record<string, unknown>): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat", refreshToken: "sk-ant-ort", expiresAt: NOW_MS + ONE_HOUR_MS, ...oauth } });
}

describe("classifyCredentials", () => {
  it("accepts a token that expires in the future", () => {
    assert.deepEqual(classifyCredentials(blob({}), NOW_MS), { kind: "valid", expiresMs: NOW_MS + ONE_HOUR_MS });
  });

  it("marks a past token with a refresh token as expired (renewable)", () => {
    assert.deepEqual(classifyCredentials(blob({ expiresAt: NOW_MS - ONE_HOUR_MS }), NOW_MS), { kind: "expired", expiresMs: NOW_MS - ONE_HOUR_MS });
  });

  it("treats a token inside the safety margin as expired", () => {
    assert.equal(classifyCredentials(blob({ expiresAt: NOW_MS + 1_000 }), NOW_MS).kind, "expired");
  });

  // The #3309 blob: a second Keychain item with nothing in it.
  it("rejects the empty shell (empty tokens, expiresAt 0) without renewing", () => {
    const empty = JSON.stringify({ claudeAiOauth: { accessToken: "", refreshToken: "", expiresAt: 0, scopes: [] } });
    assert.equal(classifyCredentials(empty, NOW_MS).kind, "unusable");
  });

  // With a refresh token the CLI can still renew, whatever the stored access token looks like.
  it("sends a broken expiry to renewal while a refresh token exists", () => {
    [0, -1, undefined, "not-a-date"].forEach((expiresAt) => {
      assert.deepEqual(
        classifyCredentials(blob({ expiresAt }), NOW_MS),
        { kind: "expired", expiresMs: typeof expiresAt === "number" ? expiresAt : null },
        String(expiresAt),
      );
    });
  });

  it("sends an empty or non-string access token to renewal while a refresh token exists", () => {
    ["", 42, undefined].forEach((accessToken) => {
      assert.equal(classifyCredentials(blob({ accessToken }), NOW_MS).kind, "expired", String(accessToken));
    });
  });

  it("rejects an empty access token when there is no refresh token either", () => {
    assert.equal(classifyCredentials(blob({ accessToken: "", refreshToken: "" }), NOW_MS).kind, "unusable");
  });

  it("rejects an expired token with no refresh token", () => {
    assert.equal(classifyCredentials(blob({ expiresAt: 0, refreshToken: 42 }), NOW_MS).kind, "unusable");
    assert.equal(classifyCredentials(blob({ expiresAt: NOW_MS - ONE_HOUR_MS, refreshToken: "" }), NOW_MS).kind, "unusable");
    assert.equal(classifyCredentials(blob({ expiresAt: NOW_MS - ONE_HOUR_MS, refreshToken: null }), NOW_MS).kind, "unusable");
  });

  it("still accepts a valid token that carries no refresh token", () => {
    assert.equal(classifyCredentials(blob({ refreshToken: undefined }), NOW_MS).kind, "valid");
  });

  it("rejects blobs with no claudeAiOauth block", () => {
    ["{not json", "null", "42", "[]", JSON.stringify({ other: 1 }), JSON.stringify({ claudeAiOauth: "x" })].forEach((raw) => {
      assert.equal(classifyCredentials(raw, NOW_MS).kind, "unusable", raw);
    });
  });

  it("names the reason so the log says what is wrong", () => {
    const verdict = classifyCredentials(blob({ expiresAt: 0, refreshToken: "" }), NOW_MS);
    assert.ok(verdict.kind === "unusable" && verdict.reason.includes("refresh token"));
  });
});

describe("renewalDecision / recordRenewal", () => {
  it("attempts when nothing has failed yet", () => {
    assert.deepEqual(renewalDecision(NO_RENEWAL_FAILURES, NOW_MS), { kind: "attempt" });
  });

  it("waits out the cooldown after a failure, then attempts again", () => {
    const failed = recordRenewal(NO_RENEWAL_FAILURES, false, NOW_MS);
    assert.deepEqual(renewalDecision(failed, NOW_MS + 1), { kind: "cooldown", retryInMs: RENEWAL_RETRY_COOLDOWN_MS - 1 });
    assert.deepEqual(renewalDecision(failed, NOW_MS + RENEWAL_RETRY_COOLDOWN_MS), { kind: "attempt" });
  });

  it("gives up for good after the maximum consecutive failures, however long it waits", () => {
    const history = Array.from({ length: MAX_CONSECUTIVE_RENEWAL_FAILURES }).reduce<typeof NO_RENEWAL_FAILURES>(
      (acc) => recordRenewal(acc, false, NOW_MS),
      NO_RENEWAL_FAILURES,
    );
    assert.deepEqual(renewalDecision(history, NOW_MS + 100 * ONE_HOUR_MS), { kind: "exhausted" });
  });

  it("allows one fewer failure than the cap to retry", () => {
    const history = { consecutiveFailures: MAX_CONSECUTIVE_RENEWAL_FAILURES - 1, lastFailureMs: NOW_MS };
    assert.deepEqual(renewalDecision(history, NOW_MS + RENEWAL_RETRY_COOLDOWN_MS), { kind: "attempt" });
  });

  it("resets on success", () => {
    const failed = recordRenewal(recordRenewal(NO_RENEWAL_FAILURES, false, NOW_MS), false, NOW_MS);
    assert.deepEqual(recordRenewal(failed, true, NOW_MS), NO_RENEWAL_FAILURES);
  });
});
