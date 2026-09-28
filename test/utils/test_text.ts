import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasControlCharacter, truncate } from "../../server/utils/text.js";

describe("truncate", () => {
  it("returns the input unchanged when shorter than max", () => {
    assert.equal(truncate("hello", 10), "hello");
  });

  it("returns the input unchanged at exactly max", () => {
    assert.equal(truncate("hello", 5), "hello");
  });

  it("truncates with default ellipsis when longer than max", () => {
    assert.equal(truncate("hello world", 8), "hello w…");
    assert.equal(truncate("hello world", 8).length, 8);
  });

  it("reserves the ellipsis length from the slice budget", () => {
    // Naive `slice(0, max) + "…"` would yield length max+1; we want
    // exactly max.
    const out = truncate("0123456789", 5);
    assert.equal(out.length, 5);
    assert.equal(out, "0123…");
  });

  it("honours a custom ellipsis", () => {
    assert.equal(truncate("abcdefghij", 6, "..."), "abc...");
    assert.equal(truncate("abcdefghij", 6, "..."), "abc...");
    assert.equal(truncate("abcdefghij", 6, " (more)"), " (more"); // ellipsis longer than max → ellipsis clipped to max
  });

  it("returns empty string when max <= 0", () => {
    assert.equal(truncate("anything", 0), "");
    assert.equal(truncate("anything", -1), "");
  });

  it("handles empty input", () => {
    assert.equal(truncate("", 5), "");
    assert.equal(truncate("", 0), "");
  });

  it("handles single-character max with multi-char ellipsis", () => {
    assert.equal(truncate("hello", 1, "..."), ".");
  });
});

describe("hasControlCharacter", () => {
  it("is false for ordinary text, including non-ASCII and emoji", () => {
    assert.equal(hasControlCharacter(""), false);
    assert.equal(hasControlCharacter("/Users/example/.env"), false);
    assert.equal(hasControlCharacter("AIzaExampleKey"), false);
    assert.equal(hasControlCharacter("日本語のパス/設定"), false);
    assert.equal(hasControlCharacter("emoji 🗝 is not a control character"), false);
  });

  it("catches C0 controls", () => {
    assert.equal(hasControlCharacter("line\nbreak"), true);
    assert.equal(hasControlCharacter("tab\tseparated"), true);
    assert.equal(hasControlCharacter("bell\u0007"), true);
  });

  it("catches DEL and the C1 range a C0-only cutoff lets through", () => {
    // U+009B is CSI: a terminal reading a log line can act on it, which is why
    // `\p{Cc}` rather than a `<= 0x1f` comparison (#3231 review).
    assert.equal(hasControlCharacter("del\u007f"), true);
    assert.equal(hasControlCharacter("csi\u009b31m"), true);
    assert.equal(hasControlCharacter("c1\u0080"), true);
    assert.equal(hasControlCharacter("c1\u009f"), true);
  });

  it("does not treat the characters just outside the control ranges as control", () => {
    assert.equal(hasControlCharacter(" "), false);
    assert.equal(hasControlCharacter("~"), false);
    assert.equal(hasControlCharacter("\u00a0"), false);
  });
});
