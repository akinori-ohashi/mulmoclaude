// Docker mounts that give the sandboxed CLI a plugin ledger it can actually
// follow (#3186). The path translation itself is in `pluginLedgerPaths.ts` and
// is pure; this module is the fs half — read, rewrite, write a copy, mount it.
//
// The copies go over the originals read-only. That is not only about protecting
// the host's ledger from a container-side edit: a write-back from the container
// would put CONTAINER paths into the file the HOST reads, which is the same bug
// this fixes, pointing the other way.

import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileAtomicSync } from "../utils/files/atomic.js";
import { claudeConfigDir } from "../utils/claudeConfigPath.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/errors.js";
import { hasTraversalSegment } from "../utils/files/safe.js";
import { isSensitiveMountPath } from "../utils/sensitiveMountPaths.js";
import { isErrorWithCode, isNonEmptyString, isRecord, isUnknownArray } from "../utils/types.js";
import {
  CONTAINER_CLAUDE_CONFIG_DIR,
  rewriteInstalledPlugins,
  rewriteKnownMarketplaces,
  toContainerConfigPath,
  toContainerPath,
  type HostPathMapping,
} from "./pluginLedgerPaths.js";
import { dockerMountArgs } from "./dockerMount.js";
import type { Platform } from "./config.js";

/** A ledger is a short index the CLI maintains, not a data file — a megabyte of
 *  it is a corrupt or hostile file rather than a big install, and reading it
 *  whole would be the one read on this path that isn't bounded. */
const MAX_LEDGER_BYTES = 1024 * 1024;

const KNOWN_MARKETPLACES_FILE = "known_marketplaces.json";
const INSTALLED_PLUGINS_FILE = "installed_plugins.json";

interface LedgerSpec {
  /** Basename inside `<claudeConfigDir>/plugins/`. */
  file: string;
  rewrite: (ledger: unknown, mappings: readonly HostPathMapping[], sep: string) => unknown;
  /** Every host path this ledger records, for deciding what has to be mounted. */
  recordedPaths: (ledger: unknown) => string[];
}

const LEDGERS: readonly LedgerSpec[] = [
  { file: KNOWN_MARKETPLACES_FILE, rewrite: rewriteKnownMarketplaces, recordedPaths: marketplaceLocations },
  { file: INSTALLED_PLUGINS_FILE, rewrite: rewriteInstalledPlugins, recordedPaths: pluginInstallPaths },
];

/** Where the container sees a plugin tree that lives OUTSIDE the config dir.
 *  `claude plugin marketplace add <local path>` is the plugin author's ordinary
 *  workflow, and no existing mount carries that tree — so without one of these
 *  the plugin works on the host and is inert in the sandbox (#3198). */
const CONTAINER_EXTERNAL_PLUGIN_ROOT = "/mnt/plugin-src";

/** A stable, collision-free container directory for one host tree. The hash is
 *  what makes it stable across turns and unique across trees; the basename is
 *  decoration, reduced to a safe set so the host path's punctuation cannot
 *  reach the mount target. */
function externalContainerRoot(hostRoot: string): string {
  const hash = createHash("sha256").update(hostRoot).digest("hex").slice(0, 8);
  const readable = [...basename(hostRoot)].map((character) => (/[A-Za-z0-9._-]/.test(character) ? character : "_")).join("");
  return `${CONTAINER_EXTERNAL_PLUGIN_ROOT}/${readable.length > 0 ? readable : "tree"}-${hash}`;
}

function marketplaceLocations(ledger: unknown): string[] {
  if (!isRecord(ledger)) return [];
  return Object.values(ledger).flatMap((entry) => (isRecord(entry) && isNonEmptyString(entry.installLocation) ? [entry.installLocation] : []));
}

function pluginInstallPaths(ledger: unknown): string[] {
  if (!isRecord(ledger) || !isRecord(ledger.plugins)) return [];
  return Object.values(ledger.plugins).flatMap((installs) =>
    isUnknownArray(installs) ? installs.flatMap((install) => (isRecord(install) && isNonEmptyString(install.installPath) ? [install.installPath] : [])) : [],
  );
}

/** Whether `candidate` sits inside `root` — used to drop a path whose parent is
 *  already being mounted, since two overlapping mounts is a way for the inner
 *  one to shadow files of the outer. The container root is irrelevant here, so
 *  any placeholder does. */
function isUnder(candidate: string, root: string, sep: string): boolean {
  return toContainerPath([{ hostRoot: root, containerRoot: "/x" }], candidate, sep) !== null;
}

export interface ExternalPluginTree {
  hostRoot: string;
  containerRoot: string;
}

/**
 * The host trees that must be mounted for the ledgers to resolve, beyond the
 * config dir the sandbox already carries.
 *
 * A path qualifies only when it is absolute, free of `.`/`..` segments, outside
 * the config dir, and NOT sensitive. The blocklist is the one reference
 * directories already use: both are "a host path the user chose", and keeping
 * one rule is what stops the second copy acquiring an entry six months late.
 *
 * Read-only, and a smaller exposure than what the sandbox already has — it
 * mounts `~/.claude`, credentials included. A plugin tree is also code the agent
 * already runs when it lives in the config dir, so this is not a new class.
 */
export function externalPluginTrees(
  candidates: readonly string[],
  hostConfigDir: string,
  sep: string,
  platform: Platform,
  home?: string,
  systemBlocked?: readonly string[],
): ExternalPluginTree[] {
  const outside = candidates.filter((candidate) => {
    if (!isAbsolute(candidate) || hasTraversalSegment(candidate)) return false;
    if (toContainerConfigPath(hostConfigDir, candidate, sep) !== null) return false;
    if (isSensitiveMountPath(candidate, { home, platform, systemBlocked })) {
      log.warn("sandbox", "plugin tree not mounted (the sandbox must never see this path)", { path: candidate });
      return false;
    }
    return true;
  });
  const unique = [...new Set(outside)];
  return unique
    .filter((candidate) => !unique.some((other) => other !== candidate && isUnder(candidate, other, sep)))
    .map((hostRoot) => ({ hostRoot, containerRoot: externalContainerRoot(hostRoot) }));
}

export interface PluginLedgerMountParams {
  /** `process.platform` at the call site. Only `win32` differs, and only in
   *  which separator the host's recorded paths use. */
  platform: Platform;
  /** Test seam. Production passes nothing and gets the real config dir. */
  hostConfigDir?: string;
  /** Test seam for where the rewritten copies land. */
  outputDir?: string;
  /** Test seam for the sensitive-path blocklist's idea of `$HOME`. */
  home?: string;
  /** Test seam for the sensitive-path blocklist's system prefixes — macOS
   *  `tmpdir()` lives under `/var`, which the real list blocks. */
  systemBlocked?: readonly string[];
}

export interface PluginLedgerMounts {
  /** `--mount` argument pairs to splice into the docker argv, after the
   *  config-dir mount. */
  args: string[];
  /** Where the staged copies were written, for the caller to remove once the
   *  container has exited. `null` when nothing was staged and so nothing needs
   *  removing. Deleting it EARLIER is not safe: the container bind-mounts these
   *  files, so they must outlive its start. */
  stagingDir: string | null;
}

// `O_NONBLOCK` because opening a FIFO waits for a writer FOREVER and this open
// is synchronous on the spawn path — a pipe where the ledger should be would
// freeze the turn rather than merely fail it. `markerHolds` in
// backend/claude-code.ts carries the same flag for the same reason, with the
// hang reproduced.
//
// Deliberately NOT `O_NOFOLLOW`, which that call site does use: its path lives
// inside the sandbox-writable workspace, where a planted symlink is the threat.
// This path is the user's own config dir, and a symlinked config file is a
// normal dotfile-manager arrangement — refusing it would silently cost the
// plugins for exactly the users most likely to have one. The `fstat` below
// still refuses a FIFO or device reached THROUGH a symlink, which is the part
// that matters here.
function openLedger(path: string): number | null {
  try {
    return openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (isErrorWithCode(error) && error.code === "ENOENT") return null;
    log.warn("sandbox", "could not open plugin ledger, leaving it as-is", { path, error: errorMessage(error) });
    return null;
  }
}

// Bounded from the descriptor we already hold, not from the path: a `stat`
// followed by a `readFile` is two resolutions of the same name and can be raced.
function readLedgerFrom(handle: number, path: string): unknown {
  const stat = fstatSync(handle);
  if (!stat.isFile()) {
    log.warn("sandbox", "plugin ledger is not a regular file, leaving it as-is", { path });
    return null;
  }
  if (stat.size > MAX_LEDGER_BYTES) {
    log.warn("sandbox", "plugin ledger too large to translate, leaving it as-is", { path, bytes: stat.size });
    return null;
  }
  const buffer = Buffer.alloc(stat.size);
  const bytesRead = readSync(handle, buffer, 0, buffer.length, 0);
  return JSON.parse(buffer.subarray(0, bytesRead).toString("utf-8"));
}

// A missing ledger is the ordinary "no plugins installed" state and must stay
// silent; anything else is logged so a permissions problem is findable rather
// than reading as "this user has no plugins".
function readLedgerTolerant(path: string): unknown {
  const handle = openLedger(path);
  if (handle === null) return null;
  try {
    return readLedgerFrom(handle, path);
  } catch (error) {
    log.warn("sandbox", "could not read plugin ledger, leaving it as-is", { path, error: errorMessage(error) });
    return null;
  } finally {
    closeSync(handle);
  }
}

interface StagedLedger {
  /** Basename, shared by the source copy and the container-side target. */
  file: string;
  content: string;
}

interface LedgerPlan {
  staged: StagedLedger[];
  /** Trees outside the config dir that the translated ledgers now point into,
   *  so the caller can mount them. */
  externalTrees: ExternalPluginTree[];
}

// Deciding WHAT to stage before creating anywhere to put it: a user with no
// plugins must not leave an empty directory behind for every sandbox turn.
//
// Both ledgers are read BEFORE either is translated, because the set of trees to
// mount is a property of the pair: a marketplace's `installLocation` and its
// plugins' `installPath`s are in different files and have to agree about where
// the tree landed.
function planLedgers(hostConfigDir: string, sep: string, platform: Platform, home?: string, systemBlocked?: readonly string[]): LedgerPlan {
  const read = LEDGERS.map((spec) => ({ spec, ledger: readLedgerTolerant(join(hostConfigDir, "plugins", spec.file)) }));
  const recorded = read.flatMap(({ spec, ledger }) => (ledger === null ? [] : spec.recordedPaths(ledger)));
  const externalTrees = externalPluginTrees(recorded, hostConfigDir, sep, platform, home, systemBlocked);

  const mappings: HostPathMapping[] = [
    { hostRoot: hostConfigDir, containerRoot: CONTAINER_CLAUDE_CONFIG_DIR },
    ...externalTrees.map(({ hostRoot, containerRoot }) => ({ hostRoot, containerRoot })),
  ];

  const staged = read.flatMap(({ spec, ledger }) => {
    if (ledger === null) return [];
    const translated = spec.rewrite(ledger, mappings, sep);
    // Nothing to translate (the file is already container-shaped, or every path
    // in it is one we will not mount). Mounting an identical copy would only add
    // a way for this to go wrong.
    if (JSON.stringify(translated) === JSON.stringify(ledger)) return [];
    return [{ file: spec.file, content: JSON.stringify(translated, null, 2) }];
  });

  // A tree is only worth mounting if a staged ledger actually points into it.
  return staged.length === 0 ? { staged: [], externalTrees: [] } : { staged, externalTrees };
}

// Mount arguments come from the shared `dockerMount` helper so the staging path
// obeys exactly the rule every other sandbox mount obeys (#3191). #3188 shipped
// this module emitting `--mount` unconditionally, which skipped a staging path
// containing a comma that `-v` carries perfectly well.
function mountArg(outputDir: string, file: string, platform: Platform): string[] | null {
  const mount = dockerMountArgs({ hostPath: join(outputDir, file), containerPath: `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/${file}`, readOnly: true }, platform);
  return mount.kind === "args" ? mount.args : null;
}

/**
 * Docker mount arguments that overlay container-shaped copies of the two plugin
 * ledgers.
 *
 * Returns no arguments when there is nothing to translate, so a user with no
 * plugins — or with all of them installed outside the config dir — runs exactly
 * the argv they ran before. Never throws: a sandbox that starts without plugins
 * beats one that does not start.
 *
 * The caller MUST pass `stagingDir` to `removePluginLedgerStaging` once the
 * container has exited, INCLUDING when the spawn it was built for never
 * happened — otherwise every turn leaves two files behind in `tmpdir()`.
 *
 * MUST be spliced in AFTER the config-dir bind mount, since these overlay files
 * that live inside it.
 */
export function pluginLedgerMountArgs(params: PluginLedgerMountParams): PluginLedgerMounts {
  const hostConfigDir = params.hostConfigDir ?? claudeConfigDir();
  const sep = params.platform === "win32" ? "\\" : "/";
  const { staged, externalTrees } = planLedgers(hostConfigDir, sep, params.platform, params.home, params.systemBlocked);
  if (staged.length === 0) return { args: [], stagingDir: null };

  // One directory per SPAWN, not per session: a turn then owns its staging
  // outright and can delete it on exit without checking whether a sibling turn
  // of the same session is still reading the same files.
  const generated = params.outputDir === undefined;
  const outputDir = params.outputDir ?? join(tmpdir(), "mulmoclaude-plugin-ledger", randomUUID());
  const mounts = staged.map((ledger) => mountArg(outputDir, ledger.file, params.platform));
  // A tree the ledger now points into but that cannot be expressed as a mount
  // would leave the CLI chasing a container path nothing carries — worse than
  // not translating it, because the host path at least existed. All or nothing.
  const treeMounts = externalTrees.map((tree) => {
    const mount = dockerMountArgs({ hostPath: tree.hostRoot, containerPath: tree.containerRoot, readOnly: true }, params.platform);
    return mount.kind === "args" ? mount.args : null;
  });
  if ([...mounts, ...treeMounts].some((mount) => mount === null)) {
    // The plugin ledgers are an addition, not a prerequisite: skipping leaves
    // the sandbox starting exactly as it does without this feature.
    log.warn("sandbox", "a path cannot be expressed as a docker mount; plugins will not load in the sandbox", { path: outputDir });
    return { args: [], stagingDir: null };
  }
  try {
    mkdirSync(outputDir, { recursive: true });
    staged.forEach((ledger) => writeFileAtomicSync(join(outputDir, ledger.file), ledger.content));
  } catch (error) {
    log.warn("sandbox", "could not stage translated plugin ledgers, plugins will not load in the sandbox", {
      path: outputDir,
      error: errorMessage(error),
    });
    // Only a directory this function generated is ours to delete; a caller that
    // named the location owns whatever else is in it.
    if (generated) removePluginLedgerStaging(outputDir);
    return { args: [], stagingDir: null };
  }
  // The external trees come FIRST: they are plain directory mounts, while the
  // ledger copies overlay files inside the config-dir mount, and an overlay has
  // to follow what it sits on.
  return { args: [...treeMounts.flatMap((mount) => mount ?? []), ...mounts.flatMap((mount) => mount ?? [])], stagingDir: outputDir };
}

/**
 * Run the spawn-and-register step, removing the staging if it throws before a
 * child process exists to own that cleanup. `spawn` throws synchronously for a
 * malformed argument, which is early enough that no `close` listener is
 * registered yet.
 */
export function withPluginLedgerCleanup<T>(stagingDir: string | null, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (stagingDir !== null) removePluginLedgerStaging(stagingDir);
    throw error;
  }
}

/** Remove a turn's staged ledger copies. Best-effort: a staging directory that
 *  outlives its turn is litter in `tmpdir()`, never a correctness problem, so a
 *  failure here must not surface as a turn failure. */
export function removePluginLedgerStaging(stagingDir: string): void {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch (error) {
    log.warn("sandbox", "could not remove plugin ledger staging dir", { path: stagingDir, error: errorMessage(error) });
  }
}
