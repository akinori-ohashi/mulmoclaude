// The image and attachment stores read and write only inside the workspace: the store folder is
// re-resolved under it on every call, so a store folder replaced by a link out is refused rather
// than becoming the root, and contents go through the verified open / write
// (plans/fix-3573-store-files.md).

import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import { makeConfinedFileOps } from "../../plugins/confined-file-ops.js";
import { artifactScope, openArtifactFile } from "./artifactMount.js";
import { storeRelativePath, storeTrustedRoot } from "./storePaths.js";

export interface StoreFiles {
  /** Bytes of a regular file in the store; throws when it is missing, a directory, or outside. */
  read: (relativePath: string) => Promise<Buffer>;
  /** Atomic write; returns the absolute path written. Creates the store folder and partitions. */
  write: (relativePath: string, content: Uint8Array) => Promise<string>;
  /** Never throws: anything but a regular file inside the store is false. */
  isFile: (relativePath: string) => Promise<boolean>;
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
    write: async (relativePath, content) => {
      const { root, trustedRoot, inStore } = storeLocation(getRoot, dirPrefix, relativePath);
      await makeConfinedFileOps({ root, trustedRoot }).write(inStore, content);
      return path.join(root, inStore);
    },
    isFile: async (relativePath) => {
      const handle = await openStoreFile(getRoot, dirPrefix, relativePath).catch(() => null);
      if (handle === null) return false;
      await handle.close();
      return true;
    },
  };
}
