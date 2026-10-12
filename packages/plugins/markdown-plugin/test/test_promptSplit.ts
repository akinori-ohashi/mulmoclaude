// presentDocument splits its system-prompt guidance: a short `promptCompact` is
// injected, and the full guide ships as a prompt file. `prompt` stays the full
// guide, so a host that ignores the split behaves as before.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROMPT_FILES_DIR_PLACEHOLDER, readPromptSplit } from "@mulmoclaude/core/prompt-files";
import { TOOL_DEFINITION } from "../src/plugins/markdown/definition";

describe("presentDocument prompt split", () => {
  it("is a valid split, so a supporting host injects the compact text", () => {
    assert.ok(readPromptSplit(TOOL_DEFINITION));
  });

  it("ships the full guide — the same text as `prompt` — as its prompt file", () => {
    assert.deepEqual(Object.values(TOOL_DEFINITION.promptFiles), [TOOL_DEFINITION.prompt]);
  });

  it("keeps the image placeholder rule inline and points at the file through the placeholder", () => {
    const [fileName] = Object.keys(TOOL_DEFINITION.promptFiles);
    assert.ok(TOOL_DEFINITION.promptCompact.includes("__too_be_replaced_image_path__"));
    assert.ok(TOOL_DEFINITION.promptCompact.includes(`${PROMPT_FILES_DIR_PLACEHOLDER}/${fileName}`));
  });
});
