// Pins the hostile-input + IO-error semantics of `resolveBridgeSessionRole` —
// the wrapper the HTTP `/connect` route runs on an untrusted sessionId before
// letting it reach the filesystem via `readSessionMeta` (codex review on #1895).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveBridgeSessionRole } from "../../../../server/api/bridge/sessionRole.ts";
import { isSafeSessionId } from "../../../../server/utils/files/sessionId.ts";

describe("isSafeSessionId", () => {
  it("accepts every legitimate session-id form we ship", () => {
    // UUID v4 from `randomUUID()` — server-side sessions
    assert.ok(isSafeSessionId("001dfd79-d6c5-4be4-9afa-454675aafc1e"));
    // transport-chat-timestamp triple — chat-state.ts:generateSessionId
    assert.ok(isSafeSessionId("telegram-chat123-1719822000000"));
    // Short IDs (16-hex) — generateShortId
    assert.ok(isSafeSessionId("a1b2c3d4e5f60718"));
    // Names with dots (e.g. legacy formats) — still safe
    assert.ok(isSafeSessionId("session.v2.abc"));
  });

  it("rejects path-traversal + separator patterns", () => {
    for (const hostile of ["../etc/passwd", "..", "../../secret", "/absolute/path", "chat/../../etc", "..\\windows\\file", "sess/../evil", "a/b", "a\\b"]) {
      assert.equal(isSafeSessionId(hostile), false, `${hostile} should be rejected`);
    }
  });

  it("rejects the empty string and overlong inputs", () => {
    assert.equal(isSafeSessionId(""), false);
    assert.equal(isSafeSessionId("a".repeat(201)), false);
    assert.equal(isSafeSessionId("a".repeat(200)), true);
  });

  it("rejects characters outside the safe-id class", () => {
    for (const hostile of ["a b", "a\nb", "a\0b", "a;b", "a$b", "a{b}", 'a"b', "abc\r"]) {
      assert.equal(isSafeSessionId(hostile), false, `${JSON.stringify(hostile)} should be rejected`);
    }
  });
});

describe("resolveBridgeSessionRole", () => {
  it("returns the roleId when the reader finds valid metadata", async () => {
    const role = await resolveBridgeSessionRole("valid-session-id", async () => ({ roleId: "office" }));
    assert.equal(role, "office");
  });

  it("returns null when the reader returns null (missing / corrupt meta)", async () => {
    const role = await resolveBridgeSessionRole("valid-session-id", async () => null);
    assert.equal(role, null);
  });

  it("returns null when the meta has no roleId field", async () => {
    const role = await resolveBridgeSessionRole("valid-session-id", async () => ({}));
    assert.equal(role, null);
  });

  it("returns null WITHOUT invoking the reader on a hostile sessionId", async () => {
    // The main security invariant: a traversal-shaped input never reaches
    // the filesystem, even if the reader would have swallowed it.
    let readerCalls = 0;
    const role = await resolveBridgeSessionRole("../etc/passwd", async () => {
      readerCalls += 1;
      return { roleId: "leaked" };
    });
    assert.equal(role, null);
    assert.equal(readerCalls, 0, "hostile input must be blocked BEFORE the reader is consulted");
  });

  it("returns null when the reader throws (IO error), never bubbles a 500", async () => {
    // `readTextUnder`'s `rethrowUnexpected` re-throws EACCES / EIO etc.
    // Unwrapped that would surface as a 500 from `/connect` — same hostile-
    // input surface, so degrade to null.
    const role = await resolveBridgeSessionRole("valid-session-id", async () => {
      throw new Error("EACCES: permission denied");
    });
    assert.equal(role, null);
  });

  it("returns null when the reader throws a non-Error value", async () => {
    // Defensive: catch { ... } swallows anything, not just Error subclasses.
    // Reject with a string via a Promise so the rule targeting production
    // throw-literal usage doesn't fire on a test that specifically pins the
    // "reader threw something weird" recovery path.
    // eslint-disable-next-line prefer-promise-reject-errors
    const role = await resolveBridgeSessionRole("valid-session-id", () => Promise.reject("boom"));
    assert.equal(role, null);
  });
});
