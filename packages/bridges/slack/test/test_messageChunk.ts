import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkSlackMessage, SLACK_MESSAGE_CHUNK_SIZE } from "../src/messageChunk.js";

describe("chunkSlackMessage", () => {
  it("uses a readable fallback for an empty reply", () => {
    assert.deepEqual(chunkSlackMessage(""), ["(empty reply)"]);
  });

  it("keeps messages at the 4,000-character boundary intact", () => {
    const text = "A".repeat(SLACK_MESSAGE_CHUNK_SIZE);
    assert.deepEqual(chunkSlackMessage(text), [text]);
  });

  it("splits a 4,001-character reply into 4,000 and 1", () => {
    const chunks = chunkSlackMessage("A".repeat(SLACK_MESSAGE_CHUNK_SIZE + 1));
    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [4000, 1],
    );
  });

  it("preserves all 4,200 characters across the split", () => {
    const text = "A".repeat(4200);
    const chunks = chunkSlackMessage(text);
    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [4000, 200],
    );
    assert.equal(chunks.join(""), text);
  });

  it("rejects invalid maximum lengths", () => {
    assert.throws(() => chunkSlackMessage("text", 0), /positive integer/);
    assert.throws(() => chunkSlackMessage("text", 1.5), /positive integer/);
  });
});
