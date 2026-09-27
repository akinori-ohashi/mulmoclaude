import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { remainingReplyMs } from "../src/reply-deadline.ts";

const RECEIVED_AT_MS = 1_000_000;
const LIMIT_MS = 300_000;

describe("remainingReplyMs", () => {
  it("is the whole limit at the moment the message arrives", () => {
    assert.equal(remainingReplyMs(RECEIVED_AT_MS, LIMIT_MS, RECEIVED_AT_MS), LIMIT_MS);
  });

  it("shrinks by the time already spent — queued or starting up", () => {
    assert.equal(remainingReplyMs(RECEIVED_AT_MS, LIMIT_MS, RECEIVED_AT_MS + 120_000), 180_000);
    assert.equal(remainingReplyMs(RECEIVED_AT_MS, LIMIT_MS, RECEIVED_AT_MS + LIMIT_MS - 1), 1);
  });

  it("is zero at and after the deadline, never negative", () => {
    [LIMIT_MS, LIMIT_MS + 1, LIMIT_MS * 10].forEach((elapsedMs) => {
      assert.equal(remainingReplyMs(RECEIVED_AT_MS, LIMIT_MS, RECEIVED_AT_MS + elapsedMs), 0);
    });
  });

  it("treats a clock that reads before the arrival as nothing spent yet", () => {
    assert.equal(remainingReplyMs(RECEIVED_AT_MS, LIMIT_MS, RECEIVED_AT_MS - 5_000), LIMIT_MS + 5_000);
  });

  it("is zero for a zero limit", () => {
    assert.equal(remainingReplyMs(RECEIVED_AT_MS, 0, RECEIVED_AT_MS), 0);
  });
});
