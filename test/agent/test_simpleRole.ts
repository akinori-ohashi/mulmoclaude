// The built-in `simple` role exists to keep the per-turn system prompt small:
// it must not pick up the heavy display tools, and it must keep `presentForm`,
// because the base prompt tells every role to ask clarifying questions with it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROLES } from "../../src/config/roles.ts";
import { TOOL_NAMES } from "../../src/config/toolNames.ts";
import { getActiveToolDescriptors } from "../../server/agent/activeTools.ts";
import { buildSystemPrompt } from "../../server/agent/prompt.ts";
import type { MemorySnapshot } from "../../server/workspace/memory/snapshot.ts";

const EMPTY_MEMORY: MemorySnapshot = { format: "atomic", entries: [] };

function roleById(roleId: string) {
  const role = ROLES.find((candidate) => candidate.id === roleId);
  assert.ok(role, `built-in role '${roleId}' must exist`);
  return role;
}

function systemPromptLength(roleId: string): number {
  const workspace = mkdtempSync(path.join(tmpdir(), "simple-role-"));
  try {
    return buildSystemPrompt({ role: roleById(roleId), workspacePath: workspace, useDocker: false, memorySnapshot: EMPTY_MEMORY }).length;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("simple role", () => {
  it("keeps presentForm (the base prompt routes every clarifying question through it) and presentCollection", () => {
    const names = getActiveToolDescriptors(roleById("simple")).map((descriptor) => descriptor.name);
    assert.ok(names.includes(TOOL_NAMES.presentForm));
    assert.ok(names.includes(TOOL_NAMES.presentCollection));
    // Kept on purpose: collections are part of plain conversation.
    assert.ok(names.includes(TOOL_NAMES.manageCollection));
  });

  it("opts out of spawnBackgroundChat, and only this role does", () => {
    const names = getActiveToolDescriptors(roleById("simple")).map((descriptor) => descriptor.name);
    assert.equal(names.includes(TOOL_NAMES.spawnBackgroundChat), false);
    const generalNames = getActiveToolDescriptors(roleById("general")).map((descriptor) => descriptor.name);
    assert.ok(generalNames.includes(TOOL_NAMES.spawnBackgroundChat));
  });

  it("does not carry the heavy display tools", () => {
    const names = getActiveToolDescriptors(roleById("simple")).map((descriptor) => descriptor.name);
    for (const heavy of [TOOL_NAMES.presentMulmoScript, TOOL_NAMES.presentDocument, TOOL_NAMES.presentHtml, TOOL_NAMES.generateImage]) {
      assert.equal(names.includes(heavy), false, heavy);
    }
  });

  it("sends a smaller system prompt than general", () => {
    assert.ok(systemPromptLength("simple") < systemPromptLength("general"));
  });
});
