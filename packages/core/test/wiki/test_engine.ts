// Filesystem-level tests for the wiki read engine (#2940).
//
// `pickFuzzyMatch` is covered in isolation by `test_resolveFuzzy.ts`;
// this file pins the resolution ORDER against a real pages directory,
// because the defect was structural: the page index is keyed by raw
// filename stems while the lookup slugified the target first, so a
// Japanese page could never match its own file. `collectLintIssues`
// sits here too — it is the only place that proves the engine hands
// the lint the index-title map.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectLintIssues, frontmatterTagIndex, resolvePagePath } from "../../src/wiki/server/engine.ts";
import { __resetPageIndexCache } from "../../src/wiki/server/pageIndex.ts";

const CJK_STEM = "不耕起栽培-カバークロップ4年計画";
const CJK_TITLE = "不耕起栽培 × カバークロップ 4年計画";

let workspace: string;
let pagesDir: string;

before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "wiki-resolve-"));
  pagesDir = path.join(workspace, "data", "wiki", "pages");
  await mkdir(pagesDir, { recursive: true });
  await writeFile(path.join(pagesDir, `${CJK_STEM}.md`), `# ${CJK_TITLE}\n\n[[${CJK_STEM}]] と [[Sakura Internet]] と [[${CJK_TITLE}]]\n`);
  await writeFile(path.join(pagesDir, "sakura-internet.md"), "# Sakura\n");
  await writeFile(path.join(pagesDir, "MyPage.md"), "# MyPage\n");
  await writeFile(
    path.join(workspace, "data", "wiki", "index.md"),
    `# Wiki\n\n- [${CJK_TITLE}](pages/${CJK_STEM}.md) — 概要\n- [Sakura Internet](pages/sakura-internet.md) — desc\n`,
  );
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  __resetPageIndexCache();
});

describe("resolvePagePath", () => {
  it("resolves a non-ASCII page by its own filename stem", async () => {
    assert.equal(await resolvePagePath(workspace, CJK_STEM), path.join(pagesDir, `${CJK_STEM}.md`));
  });

  it("still resolves the same page by its index.md display title", async () => {
    assert.equal(await resolvePagePath(workspace, CJK_TITLE), path.join(pagesDir, `${CJK_STEM}.md`));
  });

  it("resolves a non-ASCII target carrying a [[target|display]] alias", async () => {
    assert.equal(await resolvePagePath(workspace, `${CJK_STEM}|4年計画`), path.join(pagesDir, `${CJK_STEM}.md`));
  });

  it("keeps resolving ASCII display names through slugification", async () => {
    assert.equal(await resolvePagePath(workspace, "Sakura Internet"), path.join(pagesDir, "sakura-internet.md"));
  });

  it("resolves a case-carrying filename stem", async () => {
    assert.equal(await resolvePagePath(workspace, "MyPage"), path.join(pagesDir, "MyPage.md"));
  });

  it("returns null for a page that does not exist", async () => {
    assert.equal(await resolvePagePath(workspace, "存在しないページ"), null);
  });
});

describe("collectLintIssues", () => {
  // The body links the page three ways: its own stem, an ASCII display
  // name, and the index.md display title — the last resolves only
  // through the title map the engine hands the lint (Codex review).
  it("calls none of a non-ASCII page's links broken", async () => {
    const issues = await collectLintIssues(workspace);
    assert.deepEqual(
      issues.filter((issue) => issue.includes("Broken link")),
      [],
    );
  });
});

describe("frontmatterTagIndex", () => {
  it("keys by the lowercased filename stem so findTagDrift's lookup matches", () => {
    const index = frontmatterTagIndex([
      { fileName: "MyPage.md", content: "---\ntags: [alpha, Beta]\n---\n# MyPage\n" },
      { fileName: "不耕起栽培.md", content: "---\ntags: [農業]\n---\n" },
      { fileName: "plain.MD", content: "no frontmatter" },
    ]);
    assert.deepEqual([...index.keys()], ["mypage", "不耕起栽培", "plain"]);
    assert.deepEqual(index.get("mypage"), ["alpha", "beta"]);
    assert.deepEqual(index.get("plain"), []);
  });
});

// The second supported index shape: `- [[page name]]`. Its slug comes
// from the parser rather than an href, which is where #2944 lived.
describe("collectLintIssues — `- [[…]]` index form", () => {
  let wikiLinkWorkspace: string;

  before(async () => {
    wikiLinkWorkspace = await mkdtemp(path.join(tmpdir(), "wiki-bullet-"));
    const pages = path.join(wikiLinkWorkspace, "data", "wiki", "pages");
    await mkdir(pages, { recursive: true });
    await writeFile(path.join(pages, `${CJK_STEM}.md`), `# ${CJK_TITLE}\n`);
    await writeFile(path.join(wikiLinkWorkspace, "data", "wiki", "index.md"), `# Wiki\n\n- [[${CJK_STEM}]] — 概要\n`);
  });

  after(async () => {
    await rm(wikiLinkWorkspace, { recursive: true, force: true });
  });

  it("reports neither a missing file nor an orphan for a non-ASCII page", async () => {
    __resetPageIndexCache();
    assert.deepEqual(await collectLintIssues(wikiLinkWorkspace), []);
  });
});

// A malformed `- [[|display]]` entry must stay visible even when the
// display half names a real page — the case Codex raised on #2946.
describe("collectLintIssues — empty index target", () => {
  let aliasWorkspace: string;

  before(async () => {
    aliasWorkspace = await mkdtemp(path.join(tmpdir(), "wiki-alias-"));
    const pages = path.join(aliasWorkspace, "data", "wiki", "pages");
    await mkdir(pages, { recursive: true });
    await writeFile(path.join(pages, "日本語.md"), "# 日本語\n");
    await writeFile(path.join(aliasWorkspace, "data", "wiki", "index.md"), "# Wiki\n\n- [[|日本語]] — note\n");
  });

  after(async () => {
    await rm(aliasWorkspace, { recursive: true, force: true });
  });

  it("reports the malformed entry even though the display half names a real page", async () => {
    __resetPageIndexCache();
    const issues = await collectLintIssues(aliasWorkspace);
    assert.equal(issues.filter((issue) => issue.includes("Malformed entry")).length, 1);
    // The page file is not claimed by any valid entry, so it is also an
    // orphan — both halves of the truth, neither silently swallowed.
    assert.equal(issues.filter((issue) => issue.includes("Orphan page")).length, 1);
  });
});
