// manageCollection splits its system-prompt guidance: a short `promptCompact`
// is injected, and the full prompt ships as a prompt file. `prompt` stays the
// full text, so a host that ignores the split (MulmoTerminal) behaves as before.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROMPT_FILES_DIR_PLACEHOLDER, readPromptSplit } from "../../src/prompt-files/index.ts";
import { makeManageCollectionTool } from "../../src/collection/server/manageTool.ts";

const tool = makeManageCollectionTool();

describe("manageCollection prompt split", () => {
  it("is a valid split, so a supporting host injects the compact text", () => {
    assert.ok(readPromptSplit(tool));
  });

  it("ships the full prompt as its prompt file", () => {
    assert.deepEqual(Object.values(tool.promptFiles), [tool.prompt]);
  });

  it("keeps the data-loss rule inline: a partial upsert erases omitted fields, so merge", () => {
    assert.match(tool.promptCompact, /mode: "merge"/);
    assert.match(tool.promptCompact, /erases/);
  });

  it("points at the file through the placeholder before any record write", () => {
    const [fileName] = Object.keys(tool.promptFiles);
    assert.ok(tool.promptCompact.includes(`${PROMPT_FILES_DIR_PLACEHOLDER}/${fileName}`));
  });
});
