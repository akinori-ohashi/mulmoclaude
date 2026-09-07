// The gate exists because two links rotted unnoticed for months: a help file
// moved to `packages/core/assets/helps/` and a manifest was deleted outright,
// and both links still read fine (#2967). What these tests pin is not "the
// links are currently valid" — the gate itself checks that — but the two
// judgements it makes, either of which silently disarms it if it drifts:
// which targets are worth checking, and which text is prose rather than a link.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCheckableTarget, linkTargetsIn, withoutCode } from "../../../scripts/docs/check-doc-links.mjs";

const CHECKABLE: [string, string][] = [
  ["a sibling doc", "./developer.md"],
  ["a file one level up", "../package.json"],
  ["a deep repository path", "../packages/core/assets/helps/sandbox.md"],
];

// Not "invalid" — not a repository path this gate can resolve. Flagging any of
// these would make the gate cry wolf, and a noisy gate gets skipped.
const NOT_CHECKABLE: [string, string][] = [
  ["an external URL", "https://example.com/x.md"],
  ["a mailto", "mailto:someone@example.com"],
  ["a bare anchor", "#section"],
  ["a data URI", "data:image/png;base64,AAAA"],
  ["a server route", "/api/files/raw?path=foo"],
  ["a placeholder with a wildcard", "../artifacts/<short-id>.png"],
  ["a bare filename — always an example of what a USER types", "foo.png"],
  ["a bare directory path", "data/wiki/sources/foo.png"],
];

describe("isCheckableTarget", () => {
  CHECKABLE.forEach(([label, target]) => {
    it(`checks ${label}`, () => assert.equal(isCheckableTarget(target), true, target));
  });
  NOT_CHECKABLE.forEach(([label, target]) => {
    it(`skips ${label}`, () => assert.equal(isCheckableTarget(target), false, target));
  });
});

// `docs/image-path-routing.md` is a document ABOUT path rewriting, so its
// tables are full of `![](../../etc/passwd)`. Following those would have the
// gate demand the repository contain the files the prose invents.
describe("withoutCode — markdown that is shown, not followed", () => {
  it("blanks a fenced block", () => {
    assert.deepEqual(linkTargetsIn("```\n[x](../gone.md)\n```\n"), []);
  });

  it("blanks a code span", () => {
    assert.deepEqual(linkTargetsIn("A table cell: `![](../../etc/passwd)` explains the trap.\n"), []);
  });

  it("keeps a real link that sits beside code", () => {
    assert.deepEqual(linkTargetsIn("See `![](../fake.png)` and then [the doc](../real.md).\n"), ["../real.md"]);
  });

  it("preserves length, so the rest of the document is unshifted", () => {
    const text = "before `[x](../a.md)` after";
    assert.equal(withoutCode(text).length, text.length);
  });
});

describe("linkTargetsIn", () => {
  it("finds links and images, and drops the anchor", () => {
    assert.deepEqual(linkTargetsIn("[a](./x.md#head) ![b](../y.png)\n"), ["./x.md", "../y.png"]);
  });

  it("ignores a link title", () => {
    assert.deepEqual(linkTargetsIn('[a](./x.md "the title")\n'), ["./x.md"]);
  });
});
