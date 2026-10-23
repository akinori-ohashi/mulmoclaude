// The image and attachment stores read and write only inside the workspace: the store folder is
// re-resolved under it on every call, so a store folder replaced by a link out is refused rather
// than becoming the root, and contents go through the verified open / write
// (plans/fix-3573-store-files.md).

import { readdir, type FileHandle } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { resolveExistingWithinRoot, scopeRealpath } from "@mulmoclaude/core/files";
import { makeConfinedFileOps } from "../../plugins/confined-file-ops.js";
import { artifactScope, openArtifactFile } from "./artifactMount.js";
import { storeRelativePath, storeTrustedRoot } from "./storePaths.js";

export interface StoreFiles {
  /** Bytes of a regular file in the store; throws when it is missing, a directory, or outside. */
  read: (relativePath: string) => Promise<Buffer>;
  /** Atomic write. Creates the store folder and partitions; `mode` is applied through the verified handle. */
  write: (relativePath: string, content: Uint8Array, options?: { mode?: number }) => Promise<void>;
  /** Never throws: anything but a regular file inside the store is false. */
  isFile: (relativePath: string) => Promise<boolean>;
  /** Entries of a folder in the store ("" for the store itself); empty when it is missing or outside. Names only:
   *  a folder swapped for a link mid-call can name outside entries, so read contents through `read`, never by path. */
  listDir: (relativeDir: string) => Promise<Dirent[]>;
}

const rejected = (relativePath: string): Error => new Error(`path traversal rejected: ${relativePath}`);

// `getRoot()` is re-read per call because tests repoint `WORKSPACE_PATHS.<dir>` mid-run.
function storeLocation(getRoot: () => string, dirPrefix: string, relativePath: string): { root: string; trustedRoot: string; inStore: string } {
  const root = getRoot();
  const trustedRoot = storeTrustedRoot(root, dirPrefix);
  const inStore = storeRelativePath(relativePath, dirPrefix);
  if (trustedRoot === null || inStore === null) throw rejected(relativePath);
  return { root, trustedRoot, inStore };
}

async function openStoreFile(getRoot: () => string, dirPrefix: string, relativePath: string): Promise<FileHandle | null> {
  const { trustedRoot, inStore } = storeLocation(getRoot, dirPrefix, relativePath);
  const scope = await artifactScope(trustedRoot, dirPrefix);
  return scope === null ? null : openArtifactFile(scope, inStore);
}

// Only the names are check-then-use: every content read goes back through `openStoreFile`.
async function listStoreDir(getRoot: () => string, dirPrefix: string, relativeDir: string): Promise<Dirent[]> {
  const trustedRoot = storeTrustedRoot(getRoot(), dirPrefix);
  const inStore = relativeDir === "" ? "" : storeRelativePath(relativeDir, dirPrefix);
  const scope = trustedRoot === null || inStore === null ? null : await artifactScope(trustedRoot, dirPrefix);
  const scopeReal = scope === null ? null : await scopeRealpath(scope);
  const dirReal = scopeReal === null || inStore === null ? null : await resolveExistingWithinRoot(scopeReal, inStore);
  return dirReal === null ? [] : readdir(dirReal, { withFileTypes: true });
}

async function chmodStoreFile(getRoot: () => string, dirPrefix: string, relativePath: string, mode: number): Promise<void> {
  const handle = await openStoreFile(getRoot, dirPrefix, relativePath);
  if (handle === null) throw rejected(relativePath);
  try {
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}

export function makeStoreFiles(getRoot: () => string, dirPrefix: string): StoreFiles {
  return {
    read: async (relativePath) => {
      const handle = await openStoreFile(getRoot, dirPrefix, relativePath);
      if (handle === null) throw rejected(relativePath);
      try {
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    },
    write: async (relativePath, content, options = {}) => {
      const { root, trustedRoot, inStore } = storeLocation(getRoot, dirPrefix, relativePath);
      await makeConfinedFileOps({ root, trustedRoot }).write(inStore, content);
      if (options.mode !== undefined) await chmodStoreFile(getRoot, dirPrefix, relativePath, options.mode);
    },
    isFile: async (relativePath) => {
      const handle = await openStoreFile(getRoot, dirPrefix, relativePath).catch(() => null);
      if (handle === null) return false;
      await handle.close();
      return true;
    },
    listDir: (relativeDir) => listStoreDir(getRoot, dirPrefix, relativeDir).catch(() => []),
  };
}
