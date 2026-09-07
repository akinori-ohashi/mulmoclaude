// Unit tests for `matchWikiSlug` — the shared "does this [[link]]
// target name an existing page?" rule (#2940).
//
// The defect it fixes: page slugs are raw filename stems, but every
// caller slugified the target before looking it up, so a Japanese
// filename could never match itself — `wikiSlugify` strips non-ASCII
// and reduced `不耕起栽培-カバークロップ4年計画` to `-4`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchWikiSlug } from "../../src/wiki/resolve.ts";

const CJK_STEM = "不耕起栽培-カバークロップ4年計画";

describe("matchWikiSlug", () => {
  it("matches a non-ASCII filename stem literally", () => {
    assert.equal(matchWikiSlug(CJK_STEM, new Set([CJK_STEM])), CJK_STEM);
  });

  it("still matches the slugified form of a display-style target", () => {
    assert.equal(matchWikiSlug("Sakura Internet", new Set(["sakura-internet"])), "sakura-internet");
  });

  it("matches a case-carrying filename stem that slugifying would miss", () => {
    assert.equal(matchWikiSlug("MyPage", new Set(["MyPage"])), "MyPage");
  });

  it("prefers the literal stem when both forms exist", () => {
    assert.equal(matchWikiSlug("MyPage", new Set(["MyPage", "mypage"])), "MyPage");
  });

  it("trims the target before matching", () => {
    assert.equal(matchWikiSlug(`  ${CJK_STEM} `, new Set([CJK_STEM])), CJK_STEM);
  });

  it("returns null for an unknown target", () => {
    assert.equal(matchWikiSlug(CJK_STEM, new Set(["sakura-internet"])), null);
  });

  it("returns null for an empty / whitespace-only target", () => {
    assert.equal(matchWikiSlug("", new Set(["sakura-internet"])), null);
    assert.equal(matchWikiSlug("   ", new Set(["sakura-internet"])), null);
  });

  it("accepts a Map lookup (the page index) as well as a Set", () => {
    const index = new Map([[CJK_STEM, `${CJK_STEM}.md`]]);
    assert.equal(matchWikiSlug(CJK_STEM, index), CJK_STEM);
  });
});
