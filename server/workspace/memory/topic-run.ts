// One-shot topic-based migration entry point used by server startup
// (#1070 PR-B). Mirrors `runMemoryMigrationOnce` from #1029 PR-B
// but targets the topic-format restructure instead of the legacy
// memory.md flow.
//
// Idempotent: returns immediately when there is nothing to do —
// the workspace is already topic-format, there are no atomic
// entries to migrate, or the legacy `memory.md` is still in
// flight. When staging is already present from a prior crash mid-
// swap, this runner retries the swap rather than burning another
// LLM cluster call. Failures are logged and swallowed so the
// server can continue serving traffic.
//
// Concurrency: cluster runs in the background while the agent
// continues serving requests. Atomic-format reads / writes stay in
// effect right up until the swap completes; the next request after
// the swap sees the new topic layout.
//
// CLEANUP 2026-07-01: this is one-shot migration code for the
// atomic → topic transition (#1070). After every active workspace
// has been swapped to the topic format, this file plus
// `topic-migrate.ts`, `topic-cluster.ts`, `topic-swap.ts`, the CLI
// helper at `scripts/memory-swap-topic-staging.ts`, the
// `yarn memory:swap` script, and the migration call in
// `server/index.ts` can be deleted in one sweep. Topic-format
// reading / writing (`topic-types.ts`, `topic-io.ts`,
// `topic-detect.ts` — minus the atomic-format branch) stays.

import { existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import { runClaudeCli, ClaudeCliNotFoundError, type Summarize } from "../journal/archivist-cli.js";
import { WORKSPACE_DIRS, WORKSPACE_FILES } from "../paths.js";
import { LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES } from "./legacy-migration-gate.js";
import { loadAllMemoryEntries } from "./io.js";
import { makeLlmMemoryClusterer, type MemoryClusterer } from "./topic-cluster.js";
import { clusterAtomicIntoStaging, countClusterInput, isStagingSwappable, topicStagingPath } from "./topic-migrate.js";
import { swapStagingIntoMemory } from "./topic-swap.js";
import { MEMORY_TYPES } from "./types.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

export interface RunTopicMigrationDeps {
  /** Override the summarize callback (useful for tests). Defaults to
   *  the production `runClaudeCli` which spawns the Claude CLI. */
  summarize?: Summarize;
}

// Strict variant of `hasTopicFormat` that only looks at `memory/`,
// not `memory.next/`. The shared `hasTopicFormat` is intentionally
// swap-tolerant so prompt routing doesn't fall back to atomic-format
// rules during the rename window — but the runner's idempotency
// guard needs the OPPOSITE: when only `memory.next/` exists (a
// swap-in-progress or a crash mid-swap), the runner must drop into
// the "existing staging detected" retry-swap branch below, not exit.
function memoryTreeIsTopicFormat(workspaceRoot: string): boolean {
  const memoryRoot = path.join(workspaceRoot, WORKSPACE_DIRS.memoryDir);
  for (const type of MEMORY_TYPES) {
    try {
      if (statSync(path.join(memoryRoot, type)).isDirectory()) return true;
    } catch {
      // ENOENT / EACCES → keep looking; only the actual presence of
      // a `memory/<type>` dir signals migration completed.
    }
  }
  return false;
}

export async function runTopicMigrationOnce(workspaceRoot: string, deps: RunTopicMigrationDeps = {}): Promise<void> {
  if (memoryTreeIsTopicFormat(workspaceRoot)) {
    log.debug("memory", "topic-run: workspace already uses topic format, skipping");
    return;
  }
  const stagingPath = topicStagingPath(workspaceRoot);
  // A complete staging left by a crash between cluster and swap is swapped without another LLM call. An
  // incomplete one (crash during the cluster call or mid-write) would replace memory/ with a partial tree, so it
  // is discarded and the cluster runs again below.
  if (existsSync(stagingPath)) {
    if (await isStagingSwappable(stagingPath, await countClusterInput(workspaceRoot))) {
      log.info("memory", "topic-run: existing staging detected, retrying swap", { stagingPath });
      await runSwap(workspaceRoot);
      return;
    }
    log.warn("memory", "topic-run: discarding an incomplete or lossy staging from an interrupted run", { stagingPath });
    await rm(stagingPath, { recursive: true, force: true });
  }
  if (shouldDeferForLegacyMigration(workspaceRoot)) return;

  const entries = await loadAllMemoryEntries(workspaceRoot);
  if (entries.length === 0) {
    log.debug("memory", "topic-run: no atomic entries to migrate, skipping");
    return;
  }
  const summarize = deps.summarize ?? runClaudeCli;
  const clusterer = makeLlmMemoryClusterer({ summarize });
  log.info("memory", "topic-run: starting", { entryCount: entries.length });
  await clusterAndSwap(workspaceRoot, clusterer);
}

// Don't trip over an in-progress legacy `memory.md` migration from
// #1029 PR-B. Mirrors the conditions under which
// `runMemoryMigrationOnce` would actually run — legacy file present,
// past the placeholder threshold, AND `.backup` absent. The
// `.backup` check is load-bearing: when both `memory.md` and
// `.backup` exist, the legacy runner refuses to re-process (the
// backup signals "already done; user re-introduced the file"), and
// without this clause the topic runner would defer indefinitely.
//
// One guarded `statSync` (no `existsSync` first): the legacy
// migration runs in parallel and can rename / delete `memory.md`
// between an `existsSync` check and a follow-up `statSync`, turning
// the race into an unhandled rejection because this whole function
// is invoked as a floating promise on startup. ENOENT means the
// legacy file isn't there (or just got renamed away), so there's
// nothing to defer for; any other error is swallowed and the runner
// proceeds — a permission glitch should never block the topic
// restructure.
function shouldDeferForLegacyMigration(workspaceRoot: string): boolean {
  const legacyPath = path.join(workspaceRoot, WORKSPACE_FILES.memory);
  let legacyStat: ReturnType<typeof statSync> | null;
  try {
    legacyStat = statSync(legacyPath);
  } catch {
    legacyStat = null;
  }
  if (legacyStat && legacyStat.size >= LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES && !existsSync(`${legacyPath}.backup`)) {
    log.debug("memory", "topic-run: legacy memory.md still in flight, deferring", { legacyPath });
    return true;
  }
  return false;
}

async function clusterAndSwap(workspaceRoot: string, clusterer: MemoryClusterer): Promise<void> {
  try {
    const result = await clusterAtomicIntoStaging(workspaceRoot, clusterer);
    if (result.noop) {
      // `clusterAtomicIntoStaging` already logged the failure cause
      // (`clusterer threw` or `clusterer returned null`) and rm'd
      // the staging dir. Logging "staged" here would tell the user
      // to `diff` a directory that no longer exists (#1076 review).
      log.warn("memory", "topic-run: cluster did not produce staging — see prior log entry");
      return;
    }
    log.info("memory", "topic-run: staged", {
      stagingPath: result.stagingPath,
      topicCounts: result.topicCounts,
      bulletsLost: result.bulletsLost,
    });
    await runSwap(workspaceRoot);
  } catch (err) {
    // Defensive: `makeLlmMemoryClusterer` swallows summarize errors
    // and returns null today, and `clusterAtomicIntoStaging` doesn't
    // re-throw, so this branch is currently unreachable. Kept so a
    // future change in the clusterer error contract surfaces a
    // visible log instead of an unhandled rejection (the runner is
    // invoked as a floating promise on startup).
    if (err instanceof ClaudeCliNotFoundError) {
      log.warn("memory", "topic-run: claude CLI not on PATH; topic restructure deferred");
      return;
    }
    log.error("memory", "topic-run: cluster threw", { error: errorMessage(err) });
  }
}

// Swap staging into the live memory dir. The atomic format is
// parked under `memory/.atomic-backup/<ts>/` so misclassified
// migrations can be rolled back by hand without losing data.
// Failures leave staging in place; the next server start hits the
// "existing staging detected" branch above and retries.
async function runSwap(workspaceRoot: string): Promise<void> {
  const result = await swapStagingIntoMemory(workspaceRoot);
  if (result.swapped) {
    log.info("memory", "topic-run: swap complete — workspace now uses topic format", {
      backupPath: result.backupPath,
    });
  } else {
    log.warn("memory", "topic-run: swap did not complete, leaving staging in place for retry", {
      reason: result.reason ?? "unknown",
    });
  }
}
