// Unit tests for the pure wiki lint rules.
//
// Tests focus on the rule semantics — fixtures are plain strings
// and Sets, no filesystem. The interesting cases:
//
//   - findBrokenLinksInPage handles `[[slug|alias]]` correctly
//     (was the false-positive engine pre-#1297)
//   - empty-target `[[|alias]]` surfaces its own diagnostic
//     (not "broken link to empty slug")
//   - findOrphanPages / findMissingFiles symmetry — every file
//     not in index AND every index entry not in files

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findBrokenLinksInPage, findMissingFiles, findOrphanPages, findTagDrift, formatLintReport } from "../../src/wiki/lint.ts";
import type { WikiPageEntry } from "../../src/wiki/index-parse.ts";

describe("findBrokenLinksInPage — [[slug|alias]] regression", () => {
  it("uses the TARGET (left of pipe) for slug comparison, not the full body", () => {
    // Pre-#1297 the lint slugified the entire bracket content,
    // so `[[keith-rabois-ai-pm-end|キース…]]` collapsed to
    // `-ai-pm-` and missed. With parseWikiLink the slug being
    // looked up is `keith-rabois-ai-pm-end` and the existing
    // file matches.
    const content = "see [[keith-rabois-ai-pm-end|キース・ラボイス]] for context";
    const fileSlugs = new Set(["keith-rabois-ai-pm-end"]);
    assert.deepEqual(findBrokenLinksInPage("anchor.md", content, fileSlugs), []);
  });

  it("still flags genuine broken links", () => {
    const content = "see [[does-not-exist|alias]] for context";
    const fileSlugs = new Set(["other-page"]);
    const issues = findBrokenLinksInPage("anchor.md", content, fileSlugs);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.ok(issue);
    assert.match(issue, /Broken link.*anchor\.md.*does-not-exist/);
  });

  it("emits a dedicated 'empty target' diagnostic for `[[|alias]]`", () => {
    // `[[|alias]]` slugifies to "", which would otherwise be
    // indistinguishable from a real broken link. Flag it
    // separately so authors can grep.
    const content = "see [[|orphan alias]] for context";
    const fileSlugs = new Set<string>();
    const issues = findBrokenLinksInPage("a.md", content, fileSlugs);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.ok(issue);
    assert.match(issue, /empty target/);
  });

  it("resolves a non-ASCII target against its own filename stem (#2940)", () => {
    // Page files may be named in Japanese; the stem IS the slug.
    // Slugifying the target first stripped every character and made
    // every such link a false "broken link".
    const content = "see [[不耕起栽培-カバークロップ4年計画]] for context";
    const fileSlugs = new Set(["不耕起栽培-カバークロップ4年計画"]);
    assert.deepEqual(findBrokenLinksInPage("a.md", content, fileSlugs), []);
  });

  it("resolves a link written as an index.md display title", () => {
    // `resolvePagePath` and the graph both fall back to the index
    // title; without the same fallback the lint called broken exactly
    // the links they follow happily (Codex review).
    const content = "見て [[さくらインターネット]]";
    const fileSlugs = new Set(["sakura-internet"]);
    const slugByTitle = new Map([["さくらインターネット", "sakura-internet"]]);
    assert.deepEqual(findBrokenLinksInPage("a.md", content, fileSlugs, slugByTitle), []);
  });

  it("still flags a title that no index entry claims", () => {
    const content = "見て [[知らないタイトル]]";
    const fileSlugs = new Set(["sakura-internet"]);
    const slugByTitle = new Map([["さくらインターネット", "sakura-internet"]]);
    assert.equal(findBrokenLinksInPage("a.md", content, fileSlugs, slugByTitle).length, 1);
  });

  it("leaves `[[]]` alone — a zero-length body is not a wiki link at all", () => {
    // Pins the boundary Codex read the other way twice: `[[]]` matches
    // neither WIKI_LINK_PATTERN nor the renderer's scanner, so it is
    // literal text, not an empty-target link.
    assert.deepEqual(findBrokenLinksInPage("a.md", "see [[]] here", new Set(["x"])), []);
  });

  it("says a target that cannot be a filename is unusable, not merely missing", () => {
    // `../secrets` is rejected by the write guard, so `../secrets.md
    // not found` would invite creating a file that cannot exist.
    const content = "see [[../secrets]] for context";
    const issues = findBrokenLinksInPage("a.md", content, new Set<string>());
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.ok(issue);
    assert.match(issue, /cannot be a page filename/);
    assert.doesNotMatch(issue, /\.md` not found/);
  });

  it("reports a missing non-ASCII target as a broken link, not an empty target", () => {
    const content = "see [[キース・ラボイス]] for context";
    const fileSlugs = new Set<string>();
    const issues = findBrokenLinksInPage("a.md", content, fileSlugs);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.ok(issue);
    assert.match(issue, /Broken link.*キース・ラボイス\.md/);
    assert.doesNotMatch(issue, /empty target/);
  });
});

describe("findOrphanPages / findMissingFiles", () => {
  it("flags files missing from index", () => {
    const fileSlugs = new Set(["a", "b", "c"]);
    const indexedSlugs = new Set(["a", "b"]);
    assert.deepEqual(findOrphanPages(fileSlugs, indexedSlugs), ["- **Orphan page**: `c.md` exists but is missing from index.md"]);
  });

  it("flags index entries with no file", () => {
    const entries: WikiPageEntry[] = [
      { slug: "a", title: "A", description: "", tags: [] },
      { slug: "b", title: "B", description: "", tags: [] },
    ];
    const fileSlugs = new Set(["a"]);
    assert.deepEqual(findMissingFiles(entries, fileSlugs), ["- **Missing file**: index.md references `b` but the file does not exist"]);
  });
});

describe("findMissingFiles — malformed entries", () => {
  it("names an entry with no page name as malformed, not as a missing file", () => {
    // `- [[|日本語]]` parses to an empty slug; "references `` but the
    // file does not exist" is unactionable (Codex review on #2946).
    const entries: WikiPageEntry[] = [{ slug: "", title: "日本語", description: "", tags: [] }];
    const issues = findMissingFiles(entries, new Set(["sakura-internet"]));
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.ok(issue);
    assert.match(issue, /Malformed entry.*日本語.*no page name/);
  });
});

describe("findTagDrift", () => {
  it("flags slugs whose index tags disagree with frontmatter tags", () => {
    const entries: WikiPageEntry[] = [
      { slug: "a", title: "A", description: "", tags: ["x", "y"] },
      { slug: "b", title: "B", description: "", tags: ["k"] },
    ];
    const frontmatter = new Map<string, readonly string[]>([
      ["a", ["x", "z"]], // drift
      ["b", ["k"]], // match
    ]);
    const issues = findTagDrift(entries, frontmatter);
    assert.equal(issues.length, 1);
    const [issue] = issues;
    assert.ok(issue);
    assert.match(issue, /Tag drift.*a\.md/);
  });

  it("ignores entries with no frontmatter map (covered by findMissingFiles)", () => {
    const entries: WikiPageEntry[] = [{ slug: "a", title: "A", description: "", tags: ["x"] }];
    const frontmatter = new Map<string, readonly string[]>();
    assert.deepEqual(findTagDrift(entries, frontmatter), []);
  });
});

describe("formatLintReport", () => {
  it("emits the success sentinel for an empty list", () => {
    assert.match(formatLintReport([]), /No issues found/);
  });

  it("counts singular vs plural correctly", () => {
    assert.match(formatLintReport(["one"]), /1 issue found/);
    assert.match(formatLintReport(["one", "two"]), /2 issues found/);
  });
});
