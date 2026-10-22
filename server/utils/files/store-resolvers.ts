// Shared resolver factory for file-store modules (attachment-store,
// image-store). Each store used to define its own
// `safeResolve(relativePath)` wrapper of identical shape: ensure the
// root dir exists, cache its realpath, strip the leading store
// prefix, hand off to `resolveWithinRoot`. That left three name-cloned
// `safeResolve` functions that all looked read-only but two of them
// were also being used for writes — see #1754 / #1744.
//
// `makeStoreResolvers` collapses the three copies into one and
// exposes the read/write split through method names. A caller that
// wants to write reaches for `.forWrite`, which routes through the
// write-time confinement primitive instead of the read-time one.

import { mkdir, realpath } from "fs/promises";
import { resolveWithinRoot, resolveWriteWithinRoot } from "./safe.js";

export interface StoreResolvers {
  forRead: (relativePath: string) => Promise<string>;
  forWrite: (relativePath: string) => Promise<string>;
}

// Cache realpath per absolute root, not per factory instance — test
// setups override `WORKSPACE_PATHS.<dir>` mid-run, so capturing the
// path at factory-call time would pin every store to the original
// workspace. Re-reading via `getRoot()` and keying the cache on the
// returned absolute path means each tmp workspace gets its own entry.
const realPathCacheByRoot = new Map<string, string>();

async function ensureRoot(getRoot: () => string): Promise<string> {
  const root = getRoot();
  const cached = realPathCacheByRoot.get(root);
  if (cached) return cached;
  await mkdir(root, { recursive: true });
  const real = await realpath(root);
  realPathCacheByRoot.set(root, real);
  return real;
}

function stripDirPrefix(relativePath: string, dirPrefix: string): string {
  return relativePath.replace(new RegExp(`^${dirPrefix}/`), "");
}

export function makeStoreResolvers(getRoot: () => string, dirPrefix: string): StoreResolvers {
  return {
    forRead: async (relativePath) => {
      const root = await ensureRoot(getRoot);
      const result = resolveWithinRoot(root, stripDirPrefix(relativePath, dirPrefix));
      if (!result) throw new Error(`path traversal rejected: ${relativePath}`);
      return result;
    },
    forWrite: async (relativePath) => {
      const root = await ensureRoot(getRoot);
      const result = await resolveWriteWithinRoot(root, stripDirPrefix(relativePath, dirPrefix));
      if (!result) throw new Error(`path traversal rejected: ${relativePath}`);
      return result;
    },
  };
}
