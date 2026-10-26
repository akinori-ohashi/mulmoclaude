// Scoped FileOps: a lexical check on the plugin-supplied path, then a realpath check so a
// symlink inside the scope root cannot lead out of it. Contents (read / readBytes / write) also
// survive a path swapped mid-call; stat / exists / readDir / unlink stay check-then-use
// (plans/fix-3573-verified-open.md).

import path from "node:path";
import { mkdir, readdir, realpath, stat as fsStat, unlink as fsUnlink } from "node:fs/promises";
import type { FileOps } from "gui-chat-protocol";
import {
  openVerifiedWithinScope,
  realpathIfPresent,
  resolveExistingWithinRoot,
  scopeRealpath,
  writeFileVerifiedInScope,
  type VerifiedScope,
} from "@mulmoclaude/core/files";
import { isEnoent, resolveWriteWithinRoot } from "../utils/files/safe.js";
import { ensureInsideBase } from "./runtime-loader.js";

// ─────────────────────────────────────────────────────────────────────
// Path normalisation contract (see plans/done/feat-plugin-runtime-extensions-1110.md)
//
//   1. Replace `\` with `/` (Windows path.join leak repair).
//   2. `path.posix.normalize` (folds `..`, `.`, `//`).
//   3. Reject if the normalised form starts with `..`, `/` or a
//      drive letter (would escape the scope root or be absolute).
//   4. `path.join(scopeRoot, ...segments)` — platform-aware join so
//      the returned absolute path uses the host OS separator
//      (backslashes on Windows, forward slashes on POSIX). Critical
//      for `ensureInsideBase` to accept the result.
//
// Plugin authors should never need `node:path`; the platform meets
// them where they are even if they mis-import it on Windows.
// ─────────────────────────────────────────────────────────────────────

/** Resolve a plugin-supplied path to an absolute path inside the
 *  plugin's scope root. Throws on traversal. Lexical only — symlinks
 *  are checked by the FileOps below. Exported for tests. */
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

export function normalizePluginPath(scopeRoot: string, rel: string): string {
  const slashed = rel.replace(/\\/g, "/");
  const normalised = path.posix.normalize(slashed);
  // `path.posix.normalize` produces `..` alone if the input is `..` itself, hence the equality branch.
  if (normalised === ".." || normalised.startsWith("../") || normalised.startsWith("/") || WINDOWS_DRIVE_RE.test(normalised)) {
    throw new Error(`path escapes plugin scope: ${rel}`);
  }
  const segments = normalised === "." ? [] : normalised.split("/");
  const absolute = path.join(scopeRoot, ...segments);
  // Defence in depth so a future change to the lexical step cannot silently regress.
  if (!ensureInsideBase(absolute, scopeRoot)) {
    throw new Error(`path escapes plugin scope: ${rel}`);
  }
  return absolute;
}

/** The lexically checked path, relative to the scope root in host-native form ("" for the root). */
const scopeRelative = (scopeRoot: string, rel: string): string => path.relative(scopeRoot, normalizePluginPath(scopeRoot, rel));

/** An escape reads as a missing file, so callers that treat ENOENT as "not there" stay closed. */
const notInScope = (rel: string): Error & { code: string } => Object.assign(new Error(`not inside the scope: ${rel}`), { code: "ENOENT" });

/** `root` is where the plugin's files live; `trustedRoot` (the workspace) is the anchor it must stay inside,
 *  so a scope folder that is itself replaced by a symlink cannot carry the whole scope out. */
export interface FileScope {
  root: string;
  trustedRoot: string;
}

const scopeWithinTrusted = (scope: FileScope): string => path.relative(scope.trustedRoot, scope.root);

const verifiedScopeOf = async (scope: FileScope): Promise<VerifiedScope | null> => {
  const trustedReal = await realpathIfPresent(scope.trustedRoot);
  return trustedReal === null ? null : { trustedReal, scopeWithinTrusted: scopeWithinTrusted(scope) };
};

/** The scope root's realpath when it exists inside the trusted root; null when absent or led outside. */
const scopeRootIfPresent = async (scope: FileScope): Promise<string | null> => {
  const verified = await verifiedScopeOf(scope);
  return verified === null ? null : scopeRealpath(verified);
};

// Only a write creates the scope root; a read-only call against an absent root sees "missing".
const createScopeRoot = async (scope: FileScope): Promise<string> => {
  const trustedReal = await realpath(scope.trustedRoot);
  const target = await resolveWriteWithinRoot(trustedReal, scopeWithinTrusted(scope));
  if (target !== null) await mkdir(target, { recursive: true });
  const rootReal = target === null ? null : await scopeRootIfPresent(scope);
  if (rootReal === null) throw new Error(`refusing to write: the scope root ${scope.root} leads outside ${scope.trustedRoot}`);
  return rootReal;
};

const existingPath = async (scope: FileScope, rel: string): Promise<string | null> => {
  const relative = scopeRelative(scope.root, rel);
  const rootReal = await scopeRootIfPresent(scope);
  return rootReal === null ? null : resolveExistingWithinRoot(rootReal, relative);
};

const requireExisting = async (scope: FileScope, rel: string): Promise<string> => {
  const resolved = await existingPath(scope, rel);
  if (resolved === null) throw notInScope(rel);
  return resolved;
};

const readVerified = async (scope: FileScope, rel: string): Promise<Buffer> => {
  const relative = scopeRelative(scope.root, rel);
  const verified = await verifiedScopeOf(scope);
  const handle = verified === null ? null : await openVerifiedWithinScope(verified, relative);
  if (handle === null) throw notInScope(rel);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};

const writeVerified = async (scope: FileScope, rel: string, content: string | Uint8Array): Promise<void> => {
  const relative = scopeRelative(scope.root, rel);
  const rootReal = await createScopeRoot(scope);
  const target = await resolveWriteWithinRoot(rootReal, relative);
  const verified = await verifiedScopeOf(scope);
  if (target === null || verified === null) throw new Error(`refusing to write outside the scope: ${rel}`);
  await writeFileVerifiedInScope(verified, path.dirname(target), path.basename(target), content);
};

// unlink does not follow the leaf, so only the parent is confined: a link is removed, never its target.
const unlinkTarget = async (scope: FileScope, rel: string): Promise<string | null> => {
  const relative = scopeRelative(scope.root, rel);
  const rootReal = await scopeRootIfPresent(scope);
  if (rootReal === null) return null;
  if (relative === "") return rootReal;
  const parentReal = await resolveExistingWithinRoot(rootReal, path.dirname(relative));
  return parentReal === null ? null : path.join(parentReal, path.basename(relative));
};

const ignoreEnoent = async <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await operation();
  } catch (err) {
    if (isEnoent(err)) return fallback;
    throw err;
  }
};

export function makeConfinedFileOps(scope: FileScope): FileOps {
  return {
    read: async (rel) => (await readVerified(scope, rel)).toString("utf-8"),
    readBytes: async (rel) => {
      const buf = await readVerified(scope, rel);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    write: async (rel, content) => writeVerified(scope, rel, content),
    readDir: async (rel) => {
      const resolved = await existingPath(scope, rel);
      return resolved === null ? [] : ignoreEnoent(() => readdir(resolved), []);
    },
    stat: async (rel) => {
      const { mtimeMs, size } = await fsStat(await requireExisting(scope, rel));
      return { mtimeMs, size };
    },
    exists: async (rel) => (await existingPath(scope, rel)) !== null,
    unlink: async (rel) => {
      const target = await unlinkTarget(scope, rel);
      if (target !== null) await ignoreEnoent(() => fsUnlink(target), undefined);
    },
  };
}
