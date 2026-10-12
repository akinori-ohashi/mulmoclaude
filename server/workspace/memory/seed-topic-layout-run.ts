import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { WORKSPACE_DIRS, WORKSPACE_FILES } from "../paths.js";
import { MEMORY_TYPES } from "./types.js";
import { shouldSeedTopicLayout, type MemoryLayoutState } from "./seed-topic-layout.js";

function readEntriesSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readTextOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function readMemoryLayoutState(workspaceRoot: string): MemoryLayoutState {
  return {
    memoryDirEntries: readEntriesSafe(path.join(workspaceRoot, WORKSPACE_DIRS.memoryDir)),
    legacyMemoryText: readTextOrNull(path.join(workspaceRoot, WORKSPACE_FILES.memory)),
    stagingExists: existsSync(path.join(workspaceRoot, WORKSPACE_DIRS.memoryStaging)),
  };
}

/** Create the topic-layout type directories when the workspace has no memory to lose. Returns whether it did. */
export function seedTopicLayoutIfFresh(workspaceRoot: string): boolean {
  if (!shouldSeedTopicLayout(readMemoryLayoutState(workspaceRoot))) return false;
  const memoryRoot = path.join(workspaceRoot, WORKSPACE_DIRS.memoryDir);
  MEMORY_TYPES.forEach((type) => mkdirSync(path.join(memoryRoot, type), { recursive: true }));
  return true;
}
