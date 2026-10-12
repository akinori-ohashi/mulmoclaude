// Swap `conversations/memory/` ↔ `conversations/memory.next/` (#1070 PR-A).
//
// Run automatically by `runTopicMigrationOnce` right after staging,
// (a cluster that dropped bullets is never staged, so the workspace stays
// atomic). `yarn memory:swap` runs it by hand.
//
// CLEANUP 2026-07-01: see `topic-run.ts` — this file is part of
// the one-shot atomic → topic migration chain and goes when the
// chain goes.
//
// Swap mechanics:
//   memory/             →  memory/.atomic-backup-<ts>/
//   memory.next/        →  memory/
//
// The backup name carries a timestamp so re-runs (after a follow-up
// migration on a richer workspace) don't clobber prior backups.

import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { WORKSPACE_DIRS } from "../paths.js";
import { topicStagingPath } from "./topic-migrate.js";

export interface SwapResult {
  /** True when a swap actually happened. */
  swapped: boolean;
  /** Where the prior atomic layout was moved. Null if no prior data. */
  backupPath: string | null;
  /** Reason when `swapped: false`. */
  reason?: string;
}

export async function swapStagingIntoMemory(workspaceRoot: string): Promise<SwapResult> {
  const stagingPath = topicStagingPath(workspaceRoot);
  const memoryPath = path.join(workspaceRoot, WORKSPACE_DIRS.memoryDir);
  if (!(await pathExists(stagingPath))) {
    return { swapped: false, backupPath: null, reason: "staging dir not found" };
  }

  const backup = await backupExistingMemory(memoryPath);
  if (backup.error) return { swapped: false, backupPath: null, reason: backup.error };

  const promoted = await promoteStagingWithRollback(stagingPath, memoryPath, backup.path);
  if (!promoted.ok) return { swapped: false, backupPath: promoted.backupPath, reason: promoted.reason };

  const finalBackup = backup.path ? await parkBackupInsideMemory(backup.path, memoryPath) : null;
  log.info("memory", "topic-swap: done", { backupPath: finalBackup, memoryPath });
  return { swapped: true, backupPath: finalBackup };
}

// Rename an existing memory/ out of the way so staging can take over.
// Returns the parked path (null when there was nothing to back up), or
// an error string when the rename itself failed.
async function backupExistingMemory(memoryPath: string): Promise<{ path: string | null; error?: string }> {
  if (!(await pathExists(memoryPath))) return { path: null };
  const backupPath = await pickBackupPath(memoryPath);
  try {
    await rename(memoryPath, backupPath);
    return { path: backupPath };
  } catch (err) {
    log.error("memory", "topic-swap: backup rename failed", { from: memoryPath, to: backupPath, error: errorMessage(err) });
    return { path: null, error: "backup rename failed" };
  }
}

// Rename staging → memory and roll the backup back on failure. When
// rollback ALSO fails the prior data still lives at `backupPath`;
// return it so a human (or retry loop) can move it back manually —
// telling callers `null` would signal "no recovery point exists"
// (#1072 review).
async function promoteStagingWithRollback(
  stagingPath: string,
  memoryPath: string,
  backupPath: string | null,
): Promise<{ ok: true } | { ok: false; backupPath: string | null; reason: string }> {
  try {
    await rename(stagingPath, memoryPath);
    return { ok: true };
  } catch (err) {
    log.error("memory", "topic-swap: staging rename failed", { from: stagingPath, to: memoryPath, error: errorMessage(err) });
    const rollbackFailed = backupPath ? !(await tryRollback(backupPath, memoryPath)) : false;
    return { ok: false, backupPath: rollbackFailed ? backupPath : null, reason: "staging rename failed" };
  }
}

async function tryRollback(backupPath: string, memoryPath: string): Promise<boolean> {
  try {
    await rename(backupPath, memoryPath);
    return true;
  } catch (err) {
    log.error("memory", "topic-swap: rollback failed; manual intervention needed", { backupPath, memoryPath, error: errorMessage(err) });
    return false;
  }
}

// Move the backup INSIDE the new memory dir so it travels with the
// workspace. A flat sibling backup (`memory.atomic-backup`) is also
// fine but clutters `conversations/`. Returns the final backup path
// (staying at the sibling location if the move failed).
async function parkBackupInsideMemory(backupPath: string, memoryPath: string): Promise<string> {
  const inside = path.join(memoryPath, ".atomic-backup");
  await mkdir(inside, { recursive: true });
  const finalLocation = path.join(inside, path.basename(backupPath));
  try {
    await rename(backupPath, finalLocation);
    return finalLocation;
  } catch (err) {
    log.warn("memory", "topic-swap: failed to park backup inside memory/, leaving at sibling location", { backupPath, error: errorMessage(err) });
    return backupPath;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// Builds an unused backup path. We use a coarse timestamp suffix so
// re-runs sort chronologically and don't collide.
async function pickBackupPath(memoryPath: string): Promise<string> {
  const parent = path.dirname(memoryPath);
  const stamp = formatTimestamp(new Date());
  const base = `memory.atomic-backup-${stamp}`;
  let candidate = path.join(parent, base);
  let counter = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(parent, `${base}-${counter}`);
    counter += 1;
  }
  return candidate;
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}`;
}
