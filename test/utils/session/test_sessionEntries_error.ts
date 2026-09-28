// A persisted agent error (#3288) must come back after a reload as the same
// card the live path renders, and must never be mistaken for assistant text.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSessionEntries } from "../../../src/utils/session/sessionEntries.js";
import { isErrorEntry, isTextEntry, type SessionEntry } from "../../../src/types/session.js";
import { makeErrorResult } from "../../../src/utils/tools/result.js";
import { EVENT_TYPES } from "../../../src/types/events.js";

const AUTH_ERROR = "Failed to authenticate.\nRun `claude /login` in a terminal on this machine, then send your message again.";

function withoutUuid<T extends { uuid: string }>(result: T): Omit<T, "uuid"> {
  const { uuid: __uuid, ...rest } = result;
  return rest;
}

describe("isErrorEntry", () => {
  it("accepts an assistant error line with a string message", () => {
    assert.equal(isErrorEntry({ source: "assistant", type: EVENT_TYPES.error, message: AUTH_ERROR }), true);
    assert.equal(isErrorEntry({ source: "assistant", type: EVENT_TYPES.error, message: "" }), true);
  });

  it("rejects other sources, other types, and a missing or non-string message", () => {
    assert.equal(isErrorEntry({ source: "user", type: EVENT_TYPES.error, message: "x" }), false);
    assert.equal(isErrorEntry({ type: EVENT_TYPES.error, message: "x" }), false);
    assert.equal(isErrorEntry({ source: "assistant", type: EVENT_TYPES.text, message: "x" }), false);
    assert.equal(isErrorEntry({ source: "assistant", type: EVENT_TYPES.error }), false);
    const numericMessage = { source: "assistant", type: EVENT_TYPES.error, message: 42 } as unknown as SessionEntry;
    assert.equal(isErrorEntry(numericMessage), false);
  });

  it("is never also a text entry — readers keyed on text must not ingest errors", () => {
    const entry: SessionEntry = { source: "assistant", type: EVENT_TYPES.error, message: AUTH_ERROR };
    assert.equal(isTextEntry(entry), false);
  });
});

describe("parseSessionEntries — persisted errors", () => {
  it("replays an error line as the same card the live path pushes", () => {
    const [card] = parseSessionEntries([{ source: "assistant", type: EVENT_TYPES.error, message: AUTH_ERROR }]);
    assert.ok(card);
    assert.deepEqual(withoutUuid(card), withoutUuid(makeErrorResult(AUTH_ERROR)));
    assert.equal(card.message, `[Error] ${AUTH_ERROR}`);
    assert.equal(card.title, "Error");
  });

  it("keeps the error in order after the user turn that failed", () => {
    const results = parseSessionEntries([
      { source: "user", type: EVENT_TYPES.text, message: "hello" },
      { source: "assistant", type: EVENT_TYPES.error, message: "claude exited with code 2" },
    ]);
    assert.deepEqual(
      results.map((result) => result.title),
      ["You", "Error"],
    );
  });

  it("drops a malformed error line instead of rendering it", () => {
    const malformed: SessionEntry = { source: "assistant", type: EVENT_TYPES.error };
    assert.deepEqual(parseSessionEntries([malformed]), []);
  });
});
