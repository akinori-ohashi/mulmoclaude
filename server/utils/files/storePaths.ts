// Path rules for the image / attachment stores, kept free of fs so both directions can be tested.

import path from "node:path";

// `C:foo` is relative to drive C:'s cwd, so `path.isAbsolute` misses it.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:/;

/** The workspace a store root `<workspace>/<dirPrefix>` lives in; null when the root does not end in `dirPrefix`. */
export function storeTrustedRoot(absRoot: string, dirPrefix: string): string | null {
  const segments = dirPrefix.split("/");
  const anchor = path.resolve(absRoot, ...segments.map(() => ".."));
  return path.join(anchor, ...segments) === path.resolve(absRoot) ? anchor : null;
}

/** `relativePath` (workspace-relative, optionally under `dirPrefix/`) as a path inside the store; null when it
 *  is empty, absolute, drive-qualified, carries a NUL, or leads out of the store. */
export function storeRelativePath(relativePath: string, dirPrefix: string): string | null {
  const inStore = relativePath.startsWith(`${dirPrefix}/`) ? relativePath.slice(dirPrefix.length + 1) : relativePath;
  if (inStore === "" || inStore.includes("\0") || path.isAbsolute(inStore) || WINDOWS_DRIVE_RE.test(inStore)) return null;
  const normalised = path.posix.normalize(inStore.replace(/\\/g, "/"));
  return normalised === "." || normalised === ".." || normalised.startsWith("../") ? null : normalised;
}
