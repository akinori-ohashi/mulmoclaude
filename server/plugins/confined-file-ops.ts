// FileOps that refuse a path whose real location (symlinks followed) leaves the scope root.
// `makeArtifactsFileOps` folds `..` lexically only, so a symlink inside the root still reaches out.

import path from "node:path";
import { mkdir, readFile, readdir, realpath, stat as fsStat, unlink as fsUnlink } from "node:fs/promises";
import type { FileOps } from "gui-chat-protocol";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { resolveWithinRoot, resolveWriteWithinRoot } from "../utils/files/safe.js";
import { workspacePath } from "../workspace/paths.js";

/** An escape reads as a missing file, so callers that treat ENOENT as "not there" stay closed. */
const notInScope = (rel: string): Error & { code: string } => Object.assign(new Error(`not inside the scope: ${rel}`), { code: "ENOENT" });

const realRoot = async (scopeRoot: string): Promise<string> => {
  await mkdir(scopeRoot, { recursive: true });
  return realpath(scopeRoot);
};

const existingPath = async (scopeRoot: string, rel: string): Promise<string | null> => resolveWithinRoot(await realRoot(scopeRoot), rel);

const requireExisting = async (scopeRoot: string, rel: string): Promise<string> => {
  const resolved = await existingPath(scopeRoot, rel);
  if (resolved === null) throw notInScope(rel);
  return resolved;
};

export function makeConfinedFileOps(scopeRoot: string): FileOps {
  return {
    read: async (rel) => readFile(await requireExisting(scopeRoot, rel), "utf-8"),
    readBytes: async (rel) => {
      const buf = await readFile(await requireExisting(scopeRoot, rel));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    write: async (rel, content) => {
      const target = await resolveWriteWithinRoot(await realRoot(scopeRoot), rel);
      if (target === null) throw new Error(`refusing to write outside the scope: ${rel}`);
      await writeFileAtomic(target, content);
    },
    readDir: async (rel) => {
      const resolved = await existingPath(scopeRoot, rel);
      return resolved === null ? [] : readdir(resolved);
    },
    stat: async (rel) => {
      const { mtimeMs, size } = await fsStat(await requireExisting(scopeRoot, rel));
      return { mtimeMs, size };
    },
    exists: async (rel) => (await existingPath(scopeRoot, rel)) !== null,
    unlink: async (rel) => {
      const resolved = await existingPath(scopeRoot, rel);
      if (resolved !== null) await fsUnlink(resolved);
    },
  };
}

/** The workspace `artifacts/` dir, confined as above. */
export const makeConfinedArtifactsFileOps = (): FileOps => makeConfinedFileOps(path.join(workspacePath, "artifacts"));
