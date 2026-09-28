import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AUTH_FAILURE_HINT, authFailureMessage, isAuthFailureFrame } from "../../server/agent/authFailure.ts";
import { createStreamParser, type RawStreamEvent } from "../../server/agent/stream.ts";
import { isRedundantExitError } from "../../server/agent/backend/claude-code.ts";
import { EVENT_TYPES } from "../../src/types/events.ts";

const OAUTH_EXPIRED_TEXT = "Failed to authenticate: OAuth session expired and could not be refreshed";

// The two frames `claude -p --output-format stream-json` emits for a rejected
// login, trimmed to the fields the parser reads (captured from CLI 2.1.281).
function authFailureAssistantFrame(text: string): RawStreamEvent {
  return {
    type: "assistant",
    error: "authentication_failed",
    message: { content: [{ type: "text", text }] },
  };
}

function authFailureResultFrame(text: string): RawStreamEvent {
  return { type: "result", subtype: "success", result: text, session_id: "s-1" };
}

describe("isAuthFailureFrame", () => {
  it("matches an assistant frame flagged authentication_failed", () => {
    assert.equal(isAuthFailureFrame({ type: "assistant", error: "authentication_failed" }), true);
  });

  it("ignores other error kinds, other frame types, and frames without the flag", () => {
    assert.equal(isAuthFailureFrame({ type: "assistant", error: "rate_limit" }), false);
    assert.equal(isAuthFailureFrame({ type: "assistant" }), false);
    assert.equal(isAuthFailureFrame({ type: "assistant", error: undefined }), false);
    assert.equal(isAuthFailureFrame({ type: "assistant", error: null }), false);
    assert.equal(isAuthFailureFrame({ type: "assistant", error: 401 }), false);
    assert.equal(isAuthFailureFrame({ type: "assistant", error: "AUTHENTICATION_FAILED" }), false);
    // api_retry system frames carry the same string; they are retries, not the final failure.
    assert.equal(isAuthFailureFrame({ type: "system", error: "authentication_failed" }), false);
    assert.equal(isAuthFailureFrame({ type: "result", error: "authentication_failed" }), false);
  });
});

describe("authFailureMessage", () => {
  it("keeps the CLI's reason and appends the /login fix", () => {
    const message = authFailureMessage(OAUTH_EXPIRED_TEXT);
    assert.ok(message.startsWith(OAUTH_EXPIRED_TEXT));
    assert.ok(message.endsWith(AUTH_FAILURE_HINT));
    assert.match(message, /claude \/login/);
  });

  it("falls back to a generic reason when the CLI text is empty or blank", () => {
    for (const blank of ["", "   ", "\n"]) {
      const message = authFailureMessage(blank);
      assert.ok(message.startsWith("Failed to authenticate."), JSON.stringify(blank));
      assert.ok(message.endsWith(AUTH_FAILURE_HINT));
    }
  });
});

describe("createStreamParser — CLI auth failure", () => {
  it("surfaces the failure as an error with the fix, not as a reply", () => {
    const parser = createStreamParser();
    const events = parser.parse(authFailureAssistantFrame(OAUTH_EXPIRED_TEXT));
    assert.deepEqual(events, [{ type: EVENT_TYPES.error, message: authFailureMessage(OAUTH_EXPIRED_TEXT) }]);
  });

  it("does not let the closing result frame repeat the text as a reply", () => {
    const parser = createStreamParser();
    parser.parse(authFailureAssistantFrame(OAUTH_EXPIRED_TEXT));
    const resultEvents = parser.parse(authFailureResultFrame(OAUTH_EXPIRED_TEXT));
    assert.deepEqual(resultEvents, [{ type: EVENT_TYPES.claudeSessionId, id: "s-1" }]);
  });

  it("joins multiple text blocks and ignores non-text blocks", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "assistant",
      error: "authentication_failed",
      message: {
        content: [
          { type: "text", text: "Failed to authenticate. " },
          { type: "tool_use", id: "t" },
          { type: "text", text: "API Error: 401" },
        ],
      },
    });
    assert.deepEqual(events, [{ type: EVENT_TYPES.error, message: authFailureMessage("Failed to authenticate. API Error: 401") }]);
  });

  it("still produces the error when the frame has no content", () => {
    const parser = createStreamParser();
    assert.deepEqual(parser.parse({ type: "assistant", error: "authentication_failed" }), [{ type: EVENT_TYPES.error, message: authFailureMessage("") }]);
  });

  it("leaves an ordinary assistant reply untouched", () => {
    const parser = createStreamParser();
    const events = parser.parse({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } });
    assert.deepEqual(events, [
      { type: EVENT_TYPES.status, message: "Thinking..." },
      { type: EVENT_TYPES.text, message: "hello" },
    ]);
  });
});

describe("isRedundantExitError", () => {
  it("drops the bare exit-code-1 error once the stream surfaced one", () => {
    assert.equal(isRedundantExitError(true, 1, ""), true);
    assert.equal(isRedundantExitError(true, 1, "  \n"), true);
  });

  it("keeps the exit error when nothing was surfaced, or stderr says more", () => {
    assert.equal(isRedundantExitError(false, 1, ""), false);
    assert.equal(isRedundantExitError(false, 1, "boom"), false);
    assert.equal(isRedundantExitError(true, 1, "No conversation found with session ID"), false);
  });

  it("keeps any other exit code or a signal death — an independent failure", () => {
    assert.equal(isRedundantExitError(true, 2, ""), false);
    assert.equal(isRedundantExitError(true, 0, ""), false);
    assert.equal(isRedundantExitError(true, 137, ""), false);
    assert.equal(isRedundantExitError(true, null, ""), false);
  });
});
