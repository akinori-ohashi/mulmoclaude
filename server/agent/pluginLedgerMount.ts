// Docker mounts that give the sandboxed CLI a plugin ledger it can actually
// follow (#3186). The path translation itself is in `pluginLedgerPaths.ts` and
// is pure; this module is the fs half — read, rewrite, write a copy, mount it.
//
// The copies go over the originals read-only. That is not only about protecting
// the host's ledger from a container-side edit: a write-back from the container
// would put CONTAINER paths into the file the HOST reads, which is the same bug
// this fixes, pointing the other way.

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileAtomicSync } from "../utils/files/atomic.js";
import { claudeConfigDir } from "../utils/claudeConfigPath.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/errors.js";
import { isErrorWithCode } from "../utils/types.js";
import { CONTAINER_CLAUDE_CONFIG_DIR, rewriteInstalledPlugins, rewriteKnownMarketplaces } from "./pluginLedgerPaths.js";
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
  rewrite: (ledger: unknown, hostConfigDir: string, sep: string) => unknown;
}

const LEDGERS: readonly LedgerSpec[] = [
  { file: KNOWN_MARKETPLACES_FILE, rewrite: rewriteKnownMarketplaces },
  { file: INSTALLED_PLUGINS_FILE, rewrite: rewriteInstalledPlugins },
];

export interface PluginLedgerMountParams {
  /** `process.platform` at the call site. Only `win32` differs, and only in
   *  which separator the host's recorded paths use. */
  platform: Platform;
  /** Test seam. Production passes nothing and gets the real config dir. */
  hostConfigDir?: string;
  /** Test seam for where the rewritten copies land. */
  outputDir?: string;
}

export interface PluginLedgerMounts {
  /** `-v` pairs to splice into the docker argv, after the config-dir mount. */
  args: string[];
  /** Where the staged copies were written, for the caller to remove once the
   *  container has exited. `null` when nothing was staged and so nothing needs
   *  removing. Deleting it EARLIER is not safe: the container bind-mounts these
   *  files, so they must outlive its start. */
  stagingDir: string | null;
}

function readLedger(path: string): unknown {
  const stat = statSync(path);
  if (stat.size > MAX_LEDGER_BYTES) {
    log.warn("sandbox", "plugin ledger too large to translate, leaving it as-is", { path, bytes: stat.size });
    return null;
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

// A missing ledger is the ordinary "no plugins installed" state and must stay
// silent; anything else is logged so a permissions problem is findable rather
// than reading as "this user has no plugins".
function readLedgerTolerant(path: string): unknown {
  try {
    return readLedger(path);
  } catch (error) {
    if (isErrorWithCode(error) && error.code === "ENOENT") return null;
    log.warn("sandbox", "could not read plugin ledger, leaving it as-is", { path, error: errorMessage(error) });
    return null;
  }
}

function mountArgsFor(spec: LedgerSpec, hostConfigDir: string, sep: string, outputDir: string): string[] {
  const sourcePath = join(hostConfigDir, "plugins", spec.file);
  const ledger = readLedgerTolerant(sourcePath);
  if (ledger === null) return [];

  const translated = spec.rewrite(ledger, hostConfigDir, sep);
  // Nothing under the config dir to translate (every plugin lives elsewhere, or
  // the file is already container-shaped). Mounting an identical copy would only
  // add a way for this to go wrong.
  if (JSON.stringify(translated) === JSON.stringify(ledger)) return [];

  const copyPath = join(outputDir, spec.file);
  try {
    writeFileAtomicSync(copyPath, JSON.stringify(translated, null, 2));
  } catch (error) {
    log.warn("sandbox", "could not stage translated plugin ledger", { path: copyPath, error: errorMessage(error) });
    return [];
  }
  return ["-v", `${copyPath.replace(/\\/g, "/")}:${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/${spec.file}:ro`];
}

/**
 * `-v` pairs that overlay container-shaped copies of the two plugin ledgers.
 *
 * Returns no arguments when there is nothing to translate, so a user with no
 * plugins — or with all of them installed outside the config dir — runs exactly
 * the argv they ran before. Never throws: a sandbox that starts without plugins
 * beats one that does not start.
 *
 * The caller MUST pass `stagingDir` to `removePluginLedgerStaging` once the
 * container has exited, or every turn leaves two files behind in `tmpdir()`.
 *
 * MUST be spliced in AFTER the config-dir bind mount, since these overlay files
 * that live inside it.
 */
export function pluginLedgerMountArgs(params: PluginLedgerMountParams): PluginLedgerMounts {
  const hostConfigDir = params.hostConfigDir ?? claudeConfigDir();
  const sep = params.platform === "win32" ? "\\" : "/";
  // One directory per SPAWN, not per session: a turn then owns its staging
  // outright and can delete it on exit without checking whether a sibling turn
  // of the same session is still reading the same files.
  const outputDir = params.outputDir ?? join(tmpdir(), "mulmoclaude-plugin-ledger", randomUUID());
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (error) {
    log.warn("sandbox", "could not create plugin ledger staging dir, plugins will not load in the sandbox", {
      path: outputDir,
      error: errorMessage(error),
    });
    return { args: [], stagingDir: null };
  }
  const args = LEDGERS.flatMap((spec) => mountArgsFor(spec, hostConfigDir, sep, outputDir));
  return { args, stagingDir: args.length > 0 ? outputDir : null };
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
