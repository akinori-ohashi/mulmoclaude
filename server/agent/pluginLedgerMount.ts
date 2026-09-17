// Docker mounts that give the sandboxed CLI a plugin ledger it can actually
// follow (#3186). The path translation itself is in `pluginLedgerPaths.ts` and
// is pure; this module is the fs half — read, rewrite, write a copy, mount it.
//
// The copies go over the originals read-only. That is not only about protecting
// the host's ledger from a container-side edit: a write-back from the container
// would put CONTAINER paths into the file the HOST reads, which is the same bug
// this fixes, pointing the other way.

import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, realpathSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, posix as posixPath, win32 as win32Path } from "node:path";
import { tmpdir } from "node:os";
import { writeFileAtomicSync } from "../utils/files/atomic.js";
import { claudeConfigDir } from "../utils/claudeConfigPath.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/errors.js";
import { hasTraversalSegment } from "../utils/files/safe.js";
import { isSensitiveMountPath, type SensitivePathOptions } from "../utils/sensitiveMountPaths.js";
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

/** `isAbsolute` and `basename` are host-bound: on a POSIX runner the ambient
 *  ones read `C:\\Dev\\MP` as a relative path with no directory part, so a
 *  `platform` argument that does not select these changes nothing at all. Same
 *  discipline as `sensitiveMountPaths.ts` and `toPosixRelPath`. */
function pathRules(platform: Platform): typeof posixPath {
  return platform === "win32" ? win32Path : posixPath;
}

/** Enough hex for collision-freedom across one user's plugin trees without
 *  spending the name budget below on it. */
const CONTAINER_ROOT_HASH_CHARS = 8;

/** `NAME_MAX` on the filesystems the sandbox image uses.
 *
 *  Docker creates the mount TARGET inside the container, and an overlong path
 *  component fails the whole `docker run` — measured against the daemon:
 *  `mkdir …: file name too long`, container never starts. A host basename may
 *  legitimately sit at the host's own `NAME_MAX`, and appending the hash then
 *  pushes the target past it.
 *
 *  That failure bypasses the all-or-nothing rule, whose entire point is that a
 *  mount we cannot express costs the PLUGINS and not the sandbox — so the
 *  budget is enforced here, where the name is built, rather than left to
 *  `dockerMountArgs`, which sees a string it has no reason to reject. */
const MAX_MOUNT_TARGET_NAME_BYTES = 255;

/** A stable, collision-free container directory for one host tree. The hash is
 *  what makes it stable across turns and unique across trees; the basename is
 *  decoration, reduced to a safe set so the host path's punctuation cannot
 *  reach the mount target — and truncated so the two together stay nameable.
 *
 *  Truncating the readable half cannot cause a collision: the hash is taken
 *  from the FULL host path, so two trees sharing a truncated prefix still
 *  differ in it. */
function externalContainerRoot(hostRoot: string, platform: Platform): string {
  const hash = createHash("sha256").update(hostRoot).digest("hex").slice(0, CONTAINER_ROOT_HASH_CHARS);
  const sanitized = [...pathRules(platform).basename(hostRoot)].map((character) => (/[A-Za-z0-9._-]/.test(character) ? character : "_")).join("");
  // Sanitising to ASCII first is what makes a character budget a byte budget.
  const budget = MAX_MOUNT_TARGET_NAME_BYTES - hash.length - "-".length;
  const readable = (sanitized.length > 0 ? sanitized : "tree").slice(0, budget);
  return `${CONTAINER_EXTERNAL_PLUGIN_ROOT}/${readable}-${hash}`;
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

/** Two spellings of ONE tree: a Windows path differing only in case, or a
 *  symlink and its target. Mutual containment is the test because it already
 *  knows the platform's case and separator rules.
 *
 *  Without this the nesting filter drops BOTH spellings — each reads as "inside"
 *  the other — and the tree is never mounted at all. */
function sameTree(left: string, right: string, sep: string): boolean {
  return isUnder(left, right, sep) && isUnder(right, left, sep);
}

/** Resolves a host path to its physical location, or `null` when it does not
 *  exist. Injected so the decision logic here stays pure and the symlink rule is
 *  assertable without building a symlink farm. */
export type RealPathResolver = (hostPath: string) => string | null;

export interface ExternalTreeOptions {
  /** Defaults to the real home. Injected by tests. */
  home?: string | undefined;
  /** Defaults to the real system blocklist. Injected by tests, because macOS
   *  `tmpdir()` lives under `/var` and the real list blocks it. */
  systemBlocked?: readonly string[] | undefined;
  /** Defaults to `realpathSync.native`. Injected by tests so the symlink rule
   *  is assertable without building a symlink farm. */
  resolveRealPath?: RealPathResolver | undefined;
}

function realPathOrNull(hostPath: string): string | null {
  try {
    return realpathSync.native(hostPath);
  } catch {
    return null;
  }
}

export interface ExternalPluginMount {
  /** The RESOLVED host path. Binding the ledger's spelling instead is what lets
   *  a symlink named `~/dev/mp` hand the container `~/.ssh`. */
  hostPath: string;
  containerPath: string;
}

export interface ExternalPluginMounts {
  /** One bind mount per tree nothing else already carries. */
  mounts: ExternalPluginMount[];
  /** Where each ledger spelling now lives in the container. A spelling need not
   *  sit AT a mount root: it can be nested below one, or inside the config dir
   *  the sandbox already mounts, and both still have to translate. */
  mappings: HostPathMapping[];
}

interface ResolvedCandidate {
  alias: string;
  mountSource: string;
}

/** The blocklist runs on the RESOLVED path, because that is what Docker binds.
 *  Measured against the daemon: a `-v <symlink>:/x:ro` exposes the symlink's
 *  TARGET inside the container, so a lexical check alone lets any blocked
 *  directory in under a harmless name. The alias is checked too — cheap, and it
 *  keeps an obviously-blocked spelling out of the log. */
function resolveCandidate(alias: string, resolveRealPath: RealPathResolver, options: SensitivePathOptions): ResolvedCandidate | null {
  const mountSource = resolveRealPath(alias);
  if (mountSource === null) {
    log.info("sandbox", "plugin tree not mounted (no such directory on the host)", { path: alias });
    return null;
  }
  if (isSensitiveMountPath(alias, options) || isSensitiveMountPath(mountSource, options)) {
    log.warn("sandbox", "plugin tree not mounted (the sandbox must never see this path)", { path: alias, resolved: mountSource });
    return null;
  }
  return { alias, mountSource };
}

/** The smallest set of directories whose mounts carry every resolved path: one
 *  that nothing else contains, and one representative per set of mutually
 *  contained spellings (Windows case variants naming one directory). */
function mountRoots(resolved: readonly ResolvedCandidate[], sep: string): string[] {
  const sources = [...new Set(resolved.map((candidate) => candidate.mountSource))];
  const outermost = sources.filter((source) => !sources.some((other) => other !== source && isUnder(source, other, sep) && !isUnder(other, source, sep)));
  return outermost.reduce<string[]>((kept, source) => (kept.some((keeper) => sameTree(keeper, source, sep)) ? kept : [...kept, source]), []);
}

/** Where one ledger spelling lands, given the roots being mounted. The offset
 *  matters: a candidate nested BELOW a root maps to that root's container path
 *  plus the relative part, which is what makes a dropped child tree still
 *  translatable through its surviving parent. */
function mappingUnderRoots(candidate: ResolvedCandidate, roots: readonly HostPathMapping[], sep: string): HostPathMapping[] {
  const containerPath = toContainerPath(roots, candidate.mountSource, sep);
  return containerPath === null ? [] : [{ hostRoot: candidate.alias, containerRoot: containerPath }];
}

/**
 * The host trees that must be mounted for the ledgers to resolve, beyond the
 * config dir the sandbox already carries, and where every recorded spelling
 * then lives.
 *
 * A path qualifies only when it is absolute, free of `.`/`..` segments, outside
 * the config dir, resolvable, and NOT sensitive once resolved. The blocklist is
 * the one reference directories already use: both are "a host path the user
 * chose", and keeping one rule is what stops the second copy acquiring an entry
 * six months late.
 *
 * Read-only, and a smaller exposure than what the sandbox already has — it
 * mounts `~/.claude`, credentials included. A plugin tree is also code the agent
 * already runs when it lives in the config dir, so this is not a new class.
 */
export function externalPluginMounts(
  candidates: readonly string[],
  hostConfigDir: string,
  sep: string,
  platform: Platform,
  options: ExternalTreeOptions = {},
): ExternalPluginMounts {
  const outside = candidates.filter((candidate) => {
    if (!pathRules(platform).isAbsolute(candidate) || hasTraversalSegment(candidate)) return false;
    return toContainerConfigPath(hostConfigDir, candidate, sep) === null;
  });
  const resolveRealPath = options.resolveRealPath ?? realPathOrNull;
  const sensitivity: SensitivePathOptions = { home: options.home, platform, systemBlocked: options.systemBlocked };
  const resolved = [...new Set(outside)].flatMap((alias) => resolveCandidate(alias, resolveRealPath, sensitivity) ?? []);

  // A spelling whose REAL location is inside the config dir needs no mount of
  // its own — that directory is already bind-mounted, and mounting it again
  // would put the user's credentials at a second container path. Only the
  // spelling has to be translated.
  const configMapping: HostPathMapping = { hostRoot: hostConfigDir, containerRoot: CONTAINER_CLAUDE_CONFIG_DIR };
  const landsInConfig = (candidate: ResolvedCandidate): boolean => toContainerConfigPath(hostConfigDir, candidate.mountSource, sep) !== null;
  const configMappings = resolved.filter(landsInConfig).flatMap((candidate) => mappingUnderRoots(candidate, [configMapping], sep));
  const external = resolved.filter((candidate) => !landsInConfig(candidate));

  const roots = mountRoots(external, sep).map((hostPath) => ({ hostRoot: hostPath, containerRoot: externalContainerRoot(hostPath, platform) }));
  return {
    mounts: roots.map(({ hostRoot, containerRoot }) => ({ hostPath: hostRoot, containerPath: containerRoot })),
    mappings: [...configMappings, ...external.flatMap((candidate) => mappingUnderRoots(candidate, roots, sep))],
  };
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
  /** Test seam for symlink resolution. Production passes nothing and gets the
   *  real `realpathSync.native`. */
  resolveRealPath?: RealPathResolver;
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
  externalMounts: ExternalPluginMount[];
}

// Deciding WHAT to stage before creating anywhere to put it: a user with no
// plugins must not leave an empty directory behind for every sandbox turn.
//
// Both ledgers are read BEFORE either is translated, because the set of trees to
// mount is a property of the pair: a marketplace's `installLocation` and its
// plugins' `installPath`s are in different files and have to agree about where
// the tree landed.
function planLedgers(hostConfigDir: string, sep: string, params: PluginLedgerMountParams): LedgerPlan {
  const read = LEDGERS.map((spec) => ({ spec, ledger: readLedgerTolerant(join(hostConfigDir, "plugins", spec.file)) }));
  const recorded = read.flatMap(({ spec, ledger }) => (ledger === null ? [] : spec.recordedPaths(ledger)));
  const external = externalPluginMounts(recorded, hostConfigDir, sep, params.platform, {
    home: params.home,
    systemBlocked: params.systemBlocked,
    resolveRealPath: params.resolveRealPath,
  });

  // One mapping per recorded SPELLING, not per mount: the two ledgers may spell
  // one directory differently (a symlink in one, its target in the other), and a
  // spelling may sit BELOW a mount root rather than at it.
  const mappings: HostPathMapping[] = [{ hostRoot: hostConfigDir, containerRoot: CONTAINER_CLAUDE_CONFIG_DIR }, ...external.mappings];

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
  return staged.length === 0 ? { staged: [], externalMounts: [] } : { staged, externalMounts: external.mounts };
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
 * Returns no arguments when there is nothing to translate — a user with no
 * plugins, or one whose recorded paths all name somewhere we will not mount —
 * so that turn runs exactly the argv it ran before. Never throws: a sandbox that
 * starts without plugins beats one that does not start.
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
  const { staged, externalMounts } = planLedgers(hostConfigDir, sep, params);
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
  const treeMounts = externalMounts.map((tree) => {
    const mount = dockerMountArgs({ hostPath: tree.hostPath, containerPath: tree.containerPath, readOnly: true }, params.platform);
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
