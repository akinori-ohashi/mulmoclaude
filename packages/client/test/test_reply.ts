import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAckReply } from "../src/index.ts";

describe("formatAckReply", () => {
  it("returns the reply on success", () => {
    assert.equal(formatAckReply({ ok: true, reply: "hello" }), "hello");
  });

  it("returns empty string when ok with no reply", () => {
    // `{ ok: true, reply: undefined }` is not a separate case: formatAckReply
    // reads `ack.reply ?? ""` and never asks whether the key is present, so an
    // absent key and an explicit undefined reach the same branch. It is also
    // not a shape the wire can produce — JSON carries absent or null.
    assert.equal(formatAckReply({ ok: true }), "");
  });

  it("preserves an empty-string reply on success", () => {
    assert.equal(formatAckReply({ ok: true, reply: "" }), "");
  });

  it("formats error without status", () => {
    assert.equal(formatAckReply({ ok: false, error: "boom" }), "Error: boom");
  });

  it("formats error with status code", () => {
    assert.equal(formatAckReply({ ok: false, error: "boom", status: 503 }), "Error (503): boom");
  });

  it("falls back to 'unknown' when error is missing", () => {
    assert.equal(formatAckReply({ ok: false }), "Error: unknown");
    assert.equal(formatAckReply({ ok: false, status: 500 }), "Error (500): unknown");
  });

  it("treats status 0 as no status (falsy)", () => {
    assert.equal(formatAckReply({ ok: false, error: "x", status: 0 }), "Error: x");
  });

  it("does not coerce numeric status to a different format", () => {
    assert.equal(formatAckReply({ ok: false, error: "rate-limited", status: 429 }), "Error (429): rate-limited");
  });
});
