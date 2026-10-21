import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mentionsBot, selfMentionees, stripSelfMentions } from "../src/mention.js";

const self = (index: number, length: number) => ({ index, length, type: "user", isSelf: true });
const other = (index: number, length: number) => ({ index, length, type: "user", userId: "U9", isSelf: false });

describe("mentionsBot", () => {
  it("is true when any mentionee is the bot", () => {
    assert.equal(mentionsBot({ mentionees: [other(0, 3), self(4, 4)] }), true);
  });

  it("is false for other users, @All, and a missing isSelf", () => {
    assert.equal(mentionsBot({ mentionees: [other(0, 3)] }), false);
    assert.equal(mentionsBot({ mentionees: [{ index: 0, length: 4, type: "all" }] }), false);
    assert.equal(mentionsBot({ mentionees: [{ index: 0, length: 4, isSelf: "true" }] }), false);
  });

  it("is false for absent or malformed mention data", () => {
    [undefined, null, 42, "x", {}, { mentionees: null }, { mentionees: "x" }, { mentionees: [null, 1, "a"] }].forEach((mention) =>
      assert.equal(mentionsBot(mention), false),
    );
  });

  it("ignores a self mentionee with a non-integer index / length", () => {
    assert.deepEqual(
      selfMentionees({
        mentionees: [
          { index: "0", length: 4, isSelf: true },
          { index: 0, length: 1.5, isSelf: true },
        ],
      }),
      [],
    );
  });
});

describe("stripSelfMentions", () => {
  it("removes the bot's mention and trims", () => {
    assert.equal(stripSelfMentions("@bot 天気は？", { mentionees: [self(0, 4)] }), "天気は？");
    assert.equal(stripSelfMentions("教えて @bot", { mentionees: [self(4, 4)] }), "教えて");
  });

  it("keeps other users' mentions", () => {
    assert.equal(stripSelfMentions("@bob @bot hi", { mentionees: [other(0, 4), self(5, 4)] }), "@bob  hi");
  });

  it("removes several and overlapping self mentions", () => {
    assert.equal(stripSelfMentions("@bot a @bot b", { mentionees: [self(0, 4), self(7, 4)] }), "a  b");
    assert.equal(stripSelfMentions("@bot x", { mentionees: [self(0, 4), self(1, 2)] }), "x");
  });

  it("counts UTF-16 code units like LINE does", () => {
    assert.equal(stripSelfMentions("😀@bot hi", { mentionees: [self(2, 4)] }), "😀 hi");
  });

  it("returns text verbatim (no trim) when nothing is removed", () => {
    assert.equal(stripSelfMentions("  hi  ", undefined), "  hi  ");
    assert.equal(stripSelfMentions("  hi  ", { mentionees: [other(2, 2)] }), "  hi  ");
  });

  it("ignores out-of-range and empty ranges", () => {
    assert.equal(stripSelfMentions(" hi ", { mentionees: [self(-1, 2), self(2, 10), self(1, 0)] }), " hi ");
  });

  it("returns empty for a mention-only message", () => {
    assert.equal(stripSelfMentions("@bot", { mentionees: [self(0, 4)] }), "");
  });
});
