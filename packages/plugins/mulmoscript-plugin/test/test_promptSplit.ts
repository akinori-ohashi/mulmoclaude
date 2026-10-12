// presentMulmoScript splits its system-prompt guidance: a short `promptCompact`
// is injected, and the full reference ships as a prompt file. The MCP tool
// description stays the full reference, so a host that ignores the split — or
// a model loading the tool via ToolSearch — still sees everything.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROMPT_FILES_DIR_PLACEHOLDER, readPromptSplit } from "@mulmoclaude/core/prompt-files";
import { REMOTION_COMPONENT_GUIDE } from "mulmocast/remotion/guide";
import { TOOL_DEFINITION } from "../src/core/definition";

describe("presentMulmoScript prompt split", () => {
  it("is a valid split, so a supporting host injects the compact text", () => {
    assert.ok(readPromptSplit(TOOL_DEFINITION));
  });

  it("ships the tool description as its prompt files — the description is the files, in order", () => {
    assert.equal(Object.values(TOOL_DEFINITION.promptFiles).join("\n\n"), TOOL_DEFINITION.description);
  });

  it("points the agent at every file through the placeholder, never a literal path", () => {
    for (const fileName of Object.keys(TOOL_DEFINITION.promptFiles)) {
      assert.ok(TOOL_DEFINITION.promptCompact.includes(`${PROMPT_FILES_DIR_PLACEHOLDER}/${fileName}`), fileName);
    }
    assert.ok(TOOL_DEFINITION.promptCompact.length < TOOL_DEFINITION.description.length);
  });

  it("ships mulmocast's remotion component guide verbatim, so it follows the renderer", () => {
    const guideFile = Object.values(TOOL_DEFINITION.promptFiles).find((content) => content.includes(REMOTION_COMPONENT_GUIDE));
    assert.ok(guideFile, "no prompt file carries REMOTION_COMPONENT_GUIDE");
  });
});
