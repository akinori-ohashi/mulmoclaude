// Scoped FileOps: a lexical check on the plugin-supplied path, then a realpath check so a
// symlink inside the scope root cannot lead out of it. Check-then-use, like `resolveWithinRoot`: not atomic
// against a path swapped between the check and the call (Node fs has no openat / no-follow-parent).

import path from "node:path";
import { mkdir, readFile, readdir, realpath, stat as fsStat, unlink as fsUnlink } from "node:fs/promises";
import type { FileOps } from "gui-chat-protocol";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { isEnoent, resolveWriteWithinRoot } from "../utils/files/safe.js";
import { ensureInsideBase } from "./runtime-loader.js";

// ─────────────────────────────────────────────────────────────────────
// Path normalisation contract (see plans/done/feat-plugin-runtime-extensions-1110.md)
//
//   1. Replace `\` with `/` (Windows path.join leak repair).
//   2. `path.posix.normalize` (folds `..`, `.`, `//`).
//   3. Reject if the normalised form starts with `..` or `/`
//      (would escape the scope root or be absolute).
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
export function normalizePluginPath(scopeRoot: string, rel: string): string {
  const slashed = rel.replace(/\\/g, "/");
  const normalised = path.posix.normalize(slashed);
  // `path.posix.normalize` produces `..` alone if the input is `..` itself, hence the equality branch.
  if (normalised === ".." || normalised.startsWith("../") || normalised.startsWith("/")) {
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

/** Only a missing path reads as null; EACCES, ELOOP, ENOTDIR … propagate as before. */
const realpathIfPresent = async (absPath: string): Promise<string | null> => {
  try {
    return await realpath(absPath);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
};

const isWithin = (rootReal: string, candidateReal: string): boolean => candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep);

/** Real location of `relative` (host-native, from `scopeRelative`) if it exists inside the root; null when missing or outside. */
const resolveExisting = async (rootReal: string, relative: string): Promise<string | null> => {
  const candidateReal = await realpathIfPresent(path.resolve(rootReal, relative));
  return candidateReal !== null && isWithin(rootReal, candidateReal) ? candidateReal : null;
};

// Only a write creates the scope root; a read-only call against an absent root sees "missing".
const realRoot = async (scopeRoot: string): Promise<string> => {
  await mkdir(scopeRoot, { recursive: true });
  return realpath(scopeRoot);
};

const existingPath = async (scopeRoot: string, rel: string): Promise<string | null> => {
  const relative = scopeRelative(scopeRoot, rel);
  const rootReal = await realpathIfPresent(scopeRoot);
  return rootReal === null ? null : resolveExisting(rootReal, relative);
};

const requireExisting = async (scopeRoot: string, rel: string): Promise<string> => {
  const resolved = await existingPath(scopeRoot, rel);
  if (resolved === null) throw notInScope(rel);
  return resolved;
};

const writeTarget = async (scopeRoot: string, rel: string): Promise<string> => {
  const target = await resolveWriteWithinRoot(await realRoot(scopeRoot), scopeRelative(scopeRoot, rel));
  if (target === null) throw new Error(`refusing to write outside the scope: ${rel}`);
  return target;
};

// unlink does not follow the leaf, so only the parent is confined: a link is removed, never its target.
const unlinkTarget = async (scopeRoot: string, rel: string): Promise<string | null> => {
  const relative = scopeRelative(scopeRoot, rel);
  const rootReal = await realpathIfPresent(scopeRoot);
  if (rootReal === null) return null;
  if (relative === "") return rootReal;
  const parentReal = await resolveExisting(rootReal, path.dirname(relative));
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

export function makeConfinedFileOps(scopeRoot: string): FileOps {
  return {
    read: async (rel) => readFile(await requireExisting(scopeRoot, rel), "utf-8"),
    readBytes: async (rel) => {
      const buf = await readFile(await requireExisting(scopeRoot, rel));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    write: async (rel, content) => writeFileAtomic(await writeTarget(scopeRoot, rel), content),
    readDir: async (rel) => {
      const resolved = await existingPath(scopeRoot, rel);
      return resolved === null ? [] : ignoreEnoent(() => readdir(resolved), []);
    },
    stat: async (rel) => {
      const { mtimeMs, size } = await fsStat(await requireExisting(scopeRoot, rel));
      return { mtimeMs, size };
    },
    exists: async (rel) => (await existingPath(scopeRoot, rel)) !== null,
    unlink: async (rel) => {
      const target = await unlinkTarget(scopeRoot, rel);
      if (target !== null) await ignoreEnoent(() => fsUnlink(target), undefined);
    },
  };
}
