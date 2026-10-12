import { lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { WORKSPACE_DIRS, WORKSPACE_FILES } from "../paths.js";
import { MEMORY_TYPES } from "./types.js";
import { shouldSeedTopicLayout, type MemoryLayoutState } from "./seed-topic-layout.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

// `undefined` = could not be read for a reason other than absence.
type ReadResult<T> = T | null | undefined;

function isNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

function readOrMissing<T>(read: () => T): ReadResult<T> {
  try {
    return read();
  } catch (err) {
    return isNotFound(err) ? null : undefined;
  }
}

function readMemoryLayoutState(workspaceRoot: string): MemoryLayoutState {
  const entries = readOrMissing(() => readdirSync(path.join(workspaceRoot, WORKSPACE_DIRS.memoryDir)));
  const legacyText = readOrMissing(() => readFileSync(path.join(workspaceRoot, WORKSPACE_FILES.memory), "utf-8"));
  // lstat, not existsSync: a broken symlink or a permission error must not read as "no staging".
  const staging = readOrMissing(() => lstatSync(path.join(workspaceRoot, WORKSPACE_DIRS.memoryStaging)));
  return {
    memoryDirEntries: entries ?? [],
    legacyMemoryText: legacyText ?? null,
    stagingExists: staging !== null,
    unreadable: entries === undefined || legacyText === undefined || staging === undefined,
  };
}

/** Create the topic-layout type directories when the workspace has no memory to lose. Returns whether it did.
 *  Never throws: boot must not depend on it. */
export function seedTopicLayoutIfFresh(workspaceRoot: string): boolean {
  if (!shouldSeedTopicLayout(readMemoryLayoutState(workspaceRoot))) return false;
  const memoryRoot = path.join(workspaceRoot, WORKSPACE_DIRS.memoryDir);
  try {
    MEMORY_TYPES.forEach((type) => mkdirSync(path.join(memoryRoot, type), { recursive: true }));
    return true;
  } catch (err) {
    log.warn("memory", "could not create the topic memory layout; staying on the atomic one", { memoryRoot, error: errorMessage(err) });
    return false;
  }
}
