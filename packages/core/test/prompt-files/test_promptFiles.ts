// A definition's `promptCompact` + `promptFiles` split: which names and
// packages are accepted, what text gets injected (the full `prompt` whenever
// the split can't be honoured), and how the files land on disk.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PROMPT_FILES_DIR_PLACEHOLDER,
  isSafePromptFileName,
  promptFilesSubdir,
  readPromptSplit,
  referencedPromptFiles,
  renderToolPrompt,
  syncPromptFiles,
} from "../../src/prompt-files/index.ts";

// A junction needs no admin rights on Windows; lstat reports it as a symlink.
const DIR_LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

const splitDef = (files: Record<string, string> = { "guide.md": "# Guide" }) => ({
  name: "presentThing",
  prompt: "FULL PROMPT",
  promptCompact: `Short. Read ${PROMPT_FILES_DIR_PLACEHOLDER}/${Object.keys(files)[0] ?? "guide.md"} first.`,
  promptFiles: files,
});

describe("isSafePromptFileName", () => {
  it("accepts plain relative names, nested with `/`", () => {
    for (const name of ["guide.md", "a/b.md", "v2_notes-1.md"]) assert.equal(isSafePromptFileName(name), true, name);
  });
  it("rejects anything that could leave the package directory or hide", () => {
    for (const name of ["", "../x.md", "a/../b.md", "/etc/passwd", "a\\b.md", ".hidden", "a//b.md", "a/", "C:x.md", "__proto__"]) {
      assert.equal(isSafePromptFileName(name), false, name);
    }
  });
});

describe("promptFilesSubdir", () => {
  it("mirrors the node_modules layout", () => {
    assert.equal(promptFilesSubdir("weather"), "weather");
    assert.equal(promptFilesSubdir("@gui-chat-plugin/mulmoscript"), "@gui-chat-plugin/mulmoscript");
  });
  it("keeps a scoped and an unscoped name apart", () => {
    assert.notEqual(promptFilesSubdir("@a/b"), promptFilesSubdir("a__b"));
  });
  it("rejects names that could escape", () => {
    for (const name of ["", "..", "@../x", "@a/../b", "a/b", "@a/b/c", "@/b", "@a/", "/abs", "a\\b"]) {
      assert.equal(promptFilesSubdir(name), null, name);
    }
  });
});

describe("readPromptSplit", () => {
  it("reads a well-formed split", () => {
    assert.deepEqual(readPromptSplit(splitDef()), { compact: splitDef().promptCompact, files: { "guide.md": "# Guide" } });
  });
  it("is null when the split is absent or malformed", () => {
    const cases: unknown[] = [
      null,
      "x",
      { prompt: "only full" },
      { ...splitDef(), promptCompact: "   " },
      { ...splitDef(), promptCompact: 3 },
      { ...splitDef(), promptFiles: undefined },
      { ...splitDef(), promptFiles: ["guide.md"] },
      { ...splitDef(), promptFiles: { "guide.md": 1 } },
      splitDef({ "../escape.md": "x" }),
      splitDef({}),
      { ...splitDef(), promptCompact: `Read ${PROMPT_FILES_DIR_PLACEHOLDER}/missing.md first.` },
      { ...splitDef(), promptCompact: `Read ${PROMPT_FILES_DIR_PLACEHOLDER}/guide.md and ${PROMPT_FILES_DIR_PLACEHOLDER}/other.md.` },
      { ...splitDef(), promptCompact: `Read ${PROMPT_FILES_DIR_PLACEHOLDER}/guide.md☃ first.` },
      { ...splitDef(), promptCompact: `Read ${PROMPT_FILES_DIR_PLACEHOLDER}/☃.md first.` },
    ];
    for (const definition of cases) assert.equal(readPromptSplit(definition), null, JSON.stringify(definition));
  });
});

describe("referencedPromptFiles", () => {
  it("lists every referenced file, sentence punctuation dropped", () => {
    assert.deepEqual(referencedPromptFiles(`See ${PROMPT_FILES_DIR_PLACEHOLDER}/a.md, then ${PROMPT_FILES_DIR_PLACEHOLDER}/dir/b.md.`), ["a.md", "dir/b.md"]);
  });
  it("is empty when nothing is referenced, and a bare directory reference adds nothing", () => {
    assert.deepEqual(referencedPromptFiles("no files here"), []);
    assert.deepEqual(referencedPromptFiles(`Files live in ${PROMPT_FILES_DIR_PLACEHOLDER}.`), []);
  });
  it("ends a reference at whitespace or wrapping punctuation", () => {
    assert.deepEqual(referencedPromptFiles(`Read \`${PROMPT_FILES_DIR_PLACEHOLDER}/a.md\` (or ${PROMPT_FILES_DIR_PLACEHOLDER}/b.md), then go`), [
      "a.md",
      "b.md",
    ]);
  });
  it("ends a reference at sentence punctuation, Japanese included", () => {
    assert.deepEqual(
      referencedPromptFiles(
        `See ${PROMPT_FILES_DIR_PLACEHOLDER}/a.md! Or ${PROMPT_FILES_DIR_PLACEHOLDER}/b.md? 先に${PROMPT_FILES_DIR_PLACEHOLDER}/c.mdを読む。`,
      ),
      null,
    );
    assert.deepEqual(
      referencedPromptFiles(
        `See ${PROMPT_FILES_DIR_PLACEHOLDER}/a.md! Or ${PROMPT_FILES_DIR_PLACEHOLDER}/b.md? 「${PROMPT_FILES_DIR_PLACEHOLDER}/c.md」を読む。`,
      ),
      ["a.md", "b.md", "c.md"],
    );
  });
  it("is null when a reference is not a safe file name", () => {
    for (const compact of [
      `${PROMPT_FILES_DIR_PLACEHOLDER}/☃.md`,
      `${PROMPT_FILES_DIR_PLACEHOLDER}/guide.md☃`,
      `${PROMPT_FILES_DIR_PLACEHOLDER}/../x.md`,
      `${PROMPT_FILES_DIR_PLACEHOLDER}/ `,
    ]) {
      assert.equal(referencedPromptFiles(compact), null, compact);
    }
  });
  it("does not backtrack on a long run of dots", () => {
    const started = performance.now();
    assert.equal(referencedPromptFiles(`${PROMPT_FILES_DIR_PLACEHOLDER}/${".".repeat(50_000)}!`), null);
    assert.ok(performance.now() - started < 1000);
  });
  it("accepts a compact text that names only declared files, ending a sentence", () => {
    assert.ok(readPromptSplit({ ...splitDef(), promptCompact: `Read ${PROMPT_FILES_DIR_PLACEHOLDER}/guide.md.` }));
  });
});

describe("renderToolPrompt", () => {
  it("injects the compact text with the agent's directory substituted", () => {
    assert.equal(renderToolPrompt(splitDef(), "config/helps/plugins/x"), "Short. Read config/helps/plugins/x/guide.md first.");
  });
  it("replaces every placeholder", () => {
    const definition = { ...splitDef({ a: "A", b: "B" }), promptCompact: `${PROMPT_FILES_DIR_PLACEHOLDER}/a ${PROMPT_FILES_DIR_PLACEHOLDER}/b` };
    assert.equal(renderToolPrompt(definition, "/abs/dir"), "/abs/dir/a /abs/dir/b");
  });
  it("falls back to the full prompt when the files were not written", () => {
    assert.equal(renderToolPrompt(splitDef(), null), "FULL PROMPT");
  });
  it("keeps the full prompt for a definition without a split", () => {
    assert.equal(renderToolPrompt({ prompt: "FULL PROMPT" }, "config/helps/plugins/x"), "FULL PROMPT");
    assert.equal(renderToolPrompt({ description: "no prompt" }, "dir"), undefined);
  });
});

describe("syncPromptFiles", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "prompt-files-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes each package under its own directory, nested names included", () => {
    const result = syncPromptFiles(root, [
      { packageName: "@scope/pkg", definition: splitDef({ "guide.md": "G", "more/deep.md": "D" }) },
      { packageName: "other", definition: splitDef({ "guide.md": "OTHER" }) },
    ]);
    assert.deepEqual(
      [...result.written],
      [
        ["@scope/pkg", "@scope/pkg"],
        ["other", "other"],
      ],
    );
    assert.equal(readFileSync(path.join(root, "@scope", "pkg", "guide.md"), "utf-8"), "G");
    assert.equal(readFileSync(path.join(root, "@scope", "pkg", "more", "deep.md"), "utf-8"), "D");
    assert.equal(readFileSync(path.join(root, "other", "guide.md"), "utf-8"), "OTHER");
  });

  it("replaces a package's previous files but leaves other packages alone", () => {
    syncPromptFiles(root, [{ packageName: "pkg", definition: splitDef({ "old.md": "OLD" }) }]);
    mkdirSync(path.join(root, "someone-else"));
    writeFileSync(path.join(root, "someone-else", "keep.md"), "KEEP");
    syncPromptFiles(root, [{ packageName: "pkg", definition: splitDef({ "new.md": "NEW" }) }]);
    assert.deepEqual(readdirSync(path.join(root, "pkg")), ["new.md"]);
    assert.equal(readFileSync(path.join(root, "someone-else", "keep.md"), "utf-8"), "KEEP");
    assert.deepEqual(readdirSync(root).sort(), ["pkg", "someone-else"]);
  });

  it("merges the files of several tools from one package", () => {
    const result = syncPromptFiles(root, [
      { packageName: "pkg", definition: splitDef({ "a.md": "A", "shared.md": "S" }) },
      { packageName: "pkg", definition: splitDef({ "b.md": "B", "shared.md": "S" }) },
    ]);
    assert.ok(result.written.has("pkg"));
    assert.deepEqual(readdirSync(path.join(root, "pkg")).sort(), ["a.md", "b.md", "shared.md"]);
  });

  it("skips a package whose tools disagree on a file, and writes nothing for it", () => {
    const result = syncPromptFiles(root, [
      { packageName: "pkg", definition: splitDef({ "shared.md": "ONE" }) },
      { packageName: "pkg", definition: splitDef({ "shared.md": "TWO" }) },
    ]);
    assert.equal(result.written.has("pkg"), false);
    assert.match(result.problems[0]?.problem ?? "", /shared\.md/);
    assert.equal(existsSync(path.join(root, "pkg")), false);
  });

  it("skips an unsafe package name and ignores definitions without a split", () => {
    const result = syncPromptFiles(root, [
      { packageName: "../escape", definition: splitDef() },
      { packageName: "plain", definition: { prompt: "FULL" } },
    ]);
    assert.equal(result.written.size, 0);
    assert.deepEqual(
      result.problems.map((entry) => entry.packageName),
      ["../escape"],
    );
    assert.deepEqual(readdirSync(root), []);
  });

  it("an empty file set is not a split: nothing is written and previous files stay", () => {
    syncPromptFiles(root, [{ packageName: "pkg", definition: splitDef({ "old.md": "OLD" }) }]);
    const result = syncPromptFiles(root, [{ packageName: "pkg", definition: splitDef({}) }]);
    assert.equal(result.written.has("pkg"), false);
    assert.equal(readFileSync(path.join(root, "pkg", "old.md"), "utf-8"), "OLD");
  });

  it("refuses to write through a symlinked root or scope directory, leaving its target untouched", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "prompt-files-outside-"));
    try {
      mkdirSync(path.join(outside, "victim"));
      writeFileSync(path.join(outside, "victim", "keep.txt"), "KEEP");
      symlinkSync(outside, path.join(root, "@scope"), DIR_LINK_TYPE);
      const scoped = syncPromptFiles(root, [{ packageName: "@scope/victim", definition: splitDef() }]);
      assert.equal(scoped.written.size, 0);
      assert.match(scoped.problems[0]?.problem ?? "", /symlink/);
      assert.equal(readFileSync(path.join(outside, "victim", "keep.txt"), "utf-8"), "KEEP");
      assert.deepEqual(readdirSync(outside), ["victim"]);

      const linkedRoot = path.join(root, "linked-root");
      symlinkSync(outside, linkedRoot, DIR_LINK_TYPE);
      const viaRoot = syncPromptFiles(linkedRoot, [{ packageName: "victim", definition: splitDef() }]);
      assert.equal(viaRoot.written.size, 0);
      assert.equal(readFileSync(path.join(outside, "victim", "keep.txt"), "utf-8"), "KEEP");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps the previous files when writing the new set fails partway", () => {
    syncPromptFiles(root, [{ packageName: "pkg", definition: splitDef({ "old.md": "OLD" }) }]);
    // `a.md` is written as a file, then `a.md/b.md` needs it to be a directory.
    const result = syncPromptFiles(root, [{ packageName: "pkg", definition: splitDef({ "a.md": "x", "a.md/b.md": "y" }) }]);
    assert.equal(result.written.has("pkg"), false);
    assert.equal(readFileSync(path.join(root, "pkg", "old.md"), "utf-8"), "OLD");
    assert.deepEqual(readdirSync(root), ["pkg"]);
  });

  it("reports a write failure instead of throwing", () => {
    writeFileSync(path.join(root, "@scope"), "a file where the scope directory belongs");
    const result = syncPromptFiles(root, [{ packageName: "@scope/pkg", definition: splitDef() }]);
    assert.equal(result.written.size, 0);
    assert.match(result.problems[0]?.problem ?? "", /could not write/);
  });
});
