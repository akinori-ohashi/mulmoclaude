import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAckReply, type MessageAck } from "../src/index.ts";

describe("formatAckReply", () => {
  it("returns the reply on success", () => {
    assert.equal(formatAckReply({ ok: true, reply: "hello" }), "hello");
  });

  it("returns empty string when ok with no reply", () => {
    assert.equal(formatAckReply({ ok: true }), "");

    // An own `reply` property whose value is undefined is a DIFFERENT object
    // from one with no `reply` at all, and `formatAckReply` is exported, so a
    // caller can hand it either. Today both reach `ack.reply ?? ""`; an
    // implementation that switched to `"reply" in ack` would keep the case
    // above green and break this one. Built with defineProperty because the
    // literal spelling is what `exactOptionalPropertyTypes` rejects.
    const ackWithUndefinedReply: MessageAck = { ok: true };
    Object.defineProperty(ackWithUndefinedReply, "reply", { value: undefined, enumerable: true });
    assert.ok("reply" in ackWithUndefinedReply, "fixture must carry an own reply key");
    assert.equal(formatAckReply(ackWithUndefinedReply), "");
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
