import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selfMentionRanges, stripMentionRanges } from "../src/mention.js";

const self = (index: number, length: number) => ({ index, length, type: "user", isSelf: true });
const other = (index: number, length: number) => ({ index, length, type: "user", userId: "U9", isSelf: false });
const strip = (text: string, mention: unknown): string => stripMentionRanges(text, selfMentionRanges(text, mention));

describe("selfMentionRanges", () => {
  it("returns only the bot's own mentions", () => {
    assert.deepEqual(selfMentionRanges("@bob @bot hi", { mentionees: [other(0, 4), self(5, 4)] }), [{ index: 5, length: 4 }]);
  });

  it("ignores other users, @All, and an isSelf that is not literally true", () => {
    assert.deepEqual(selfMentionRanges("@bob hi", { mentionees: [other(0, 4)] }), []);
    assert.deepEqual(selfMentionRanges("@All hi", { mentionees: [{ index: 0, length: 4, type: "all" }] }), []);
    assert.deepEqual(selfMentionRanges("@bot hi", { mentionees: [{ index: 0, length: 4, isSelf: "true" }] }), []);
  });

  it("returns none for absent or malformed mention data", () => {
    [undefined, null, 42, "x", {}, { mentionees: null }, { mentionees: "x" }, { mentionees: [null, 1, "a"] }].forEach((mention) =>
      assert.deepEqual(selfMentionRanges("@bot hi", mention), []),
    );
  });

  it("rejects non-integer, negative, empty and out-of-range self mentions", () => {
    const mention = {
      mentionees: [{ index: "0", length: 4, isSelf: true }, { index: 0, length: 1.5, isSelf: true }, self(-1, 4), self(1, 0), self(5, 3), self(0, 8)],
    };
    assert.deepEqual(selfMentionRanges("@bot hi", mention), []);
  });

  it("accepts a range ending exactly at the end of the text", () => {
    assert.deepEqual(selfMentionRanges("hi @bot", { mentionees: [self(3, 4)] }), [{ index: 3, length: 4 }]);
  });
});

describe("stripMentionRanges", () => {
  it("removes the bot's mention and trims", () => {
    assert.equal(strip("@bot 天気は？", { mentionees: [self(0, 4)] }), "天気は？");
    assert.equal(strip("教えて @bot", { mentionees: [self(4, 4)] }), "教えて");
  });

  it("keeps other users' mentions", () => {
    assert.equal(strip("@bob @bot hi", { mentionees: [other(0, 4), self(5, 4)] }), "@bob  hi");
  });

  it("removes several and overlapping ranges", () => {
    assert.equal(strip("@bot a @bot b", { mentionees: [self(0, 4), self(7, 4)] }), "a  b");
    assert.equal(strip("@bot x", { mentionees: [self(0, 4), self(1, 2)] }), "x");
  });

  it("counts UTF-16 code units like LINE does", () => {
    assert.equal(strip("😀@bot hi", { mentionees: [self(2, 4)] }), "😀 hi");
  });

  it("returns empty for a mention-only message", () => {
    assert.equal(strip("@bot", { mentionees: [self(0, 4)] }), "");
  });
});
