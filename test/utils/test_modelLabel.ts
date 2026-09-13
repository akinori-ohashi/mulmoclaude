import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatModelLabel } from "../../src/utils/format/modelLabel.js";

// The input is whatever the `claude` CLI put in its `system`/`init` frame, so
// the contract is: never throw, and never hide a value we failed to parse —
// showing a raw id beats showing nothing when the point of the feature is
// telling the user which model they are on (#2554).

describe("formatModelLabel", () => {
  it("renders the shapes the CLI actually emits", () => {
    assert.equal(formatModelLabel("claude-haiku-4-5-20251001"), "Haiku 4.5");
    assert.equal(formatModelLabel("claude-opus-5[1m]"), "Opus 5 · 1M");
    assert.equal(formatModelLabel("claude-fable-5-1"), "Fable 5.1");
    assert.equal(formatModelLabel("claude-sonnet-5"), "Sonnet 5");
  });

  // The suffix is the tell that the shared ~/.claude/settings.json supplied the
  // model, so dropping it would erase the very signal this feature exists for.
  it("keeps the context suffix", () => {
    assert.equal(formatModelLabel("claude-opus-5[1m]"), "Opus 5 · 1M");
    assert.equal(formatModelLabel("claude-haiku-4-5-20251001[200k]"), "Haiku 4.5 · 200K");
  });

  it("passes an unrecognised id through verbatim rather than dropping it", () => {
    assert.equal(formatModelLabel("some-future-model"), "some-future-model");
    assert.equal(formatModelLabel("gpt-4o"), "gpt-4o");
    assert.equal(formatModelLabel("claude-Opus-5"), "claude-Opus-5");
    assert.equal(formatModelLabel("claude-opus"), "claude-opus");
  });

  it("returns an empty label for absent or blank input, so the chip can hide", () => {
    assert.equal(formatModelLabel(undefined), "");
    assert.equal(formatModelLabel(""), "");
    assert.equal(formatModelLabel("   "), "");
  });

  it("does not throw on malformed brackets", () => {
    assert.equal(formatModelLabel("claude-opus-5[]"), "Opus 5");
    assert.equal(formatModelLabel("claude-opus-5["), "claude-opus-5[");
    assert.equal(formatModelLabel("[1m]"), "[1m]");
    assert.equal(formatModelLabel("]["), "][");
  });

  // The implementation parses by splitting rather than with one matching
  // regex, because the natural pattern nests a quantifier inside a quantifier
  // and both `security/detect-unsafe-regex` and `sonarjs/super-linear-regex`
  // reject that shape. Honest note: no input was found that made the old regex
  // actually pathological — this closes a flagged risk pattern, not a measured
  // exploit. The old and new implementations agreed on 11,891 generated inputs.
  it("handles long and adversarial input without blowing up", () => {
    assert.equal(formatModelLabel(`claude-opus-${"1-".repeat(200)}!`), `claude-opus-${"1-".repeat(200)}!`);
    assert.equal(formatModelLabel("a".repeat(5000)), "a".repeat(5000));
    assert.equal(formatModelLabel(`claude-opus-5${"[".repeat(500)}`), `claude-opus-5${"[".repeat(500)}`);
  });

  it("trims incidental whitespace", () => {
    assert.equal(formatModelLabel("  claude-opus-5[1m]  "), "Opus 5 · 1M");
  });
});
