// Containment that survives a path swapped between the check and the use (#3573). Node fs has no
// openat, so a read opens first and then proves the handle is the in-root file, and a write
// verifies its staging file before renaming within that same directory. See
// plans/fix-3573-verified-open.md for what is closed and what stays best-effort.

import { constants, promises, type BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { renameWithWindowsRetry } from "./atomic.js";
import { isEnoent } from "./safe.js";

// O_NOFOLLOW / O_NONBLOCK are undefined on Windows; a FIFO planted in the workspace must not block the read.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
const STAGING_SUFFIX_BYTES = 6;

/** Test seams at the points where a real race would swap a path. */
export interface VerifiedFileHooks {
  beforeOpen?: () => Promise<void>;
  afterOpen?: () => Promise<void>;
  beforeRename?: () => Promise<void>;
}

/** Only a missing path reads as null; EACCES, ELOOP, ENOTDIR … propagate. */
export async function realpathIfPresent(absPath: string): Promise<string | null> {
  try {
    return await promises.realpath(absPath);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

const isWithin = (rootReal: string, candidateReal: string): boolean => candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep);

/** Real location of `relative` (host-native) if it exists inside `rootReal`; null when missing or outside. `rootReal` MUST be a realpath. */
export async function resolveExistingWithinRoot(rootReal: string, relative: string): Promise<string | null> {
  const candidateReal = await realpathIfPresent(path.resolve(rootReal, relative));
  return candidateReal !== null && isWithin(rootReal, candidateReal) ? candidateReal : null;
}

const sameFile = (onDisk: BigIntStats, opened: BigIntStats): boolean => onDisk.dev === opened.dev && onDisk.ino === opened.ino;

async function lstatIfPresent(absPath: string): Promise<BigIntStats | null> {
  try {
    return await promises.lstat(absPath, { bigint: true });
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

async function openIfPresent(absPath: string, flags: number): Promise<FileHandle | null> {
  try {
    return await promises.open(absPath, flags);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** The root pathname plus the directory it named when the call began, so a root renamed away and
 *  replaced by another directory mid-call is caught — the pathname alone would accept it. */
interface BoundRoot {
  real: string;
  identity: BigIntStats;
}

async function bindRoot(rootReal: string): Promise<BoundRoot | null> {
  const identity = await lstatIfPresent(rootReal);
  return identity === null ? null : { real: rootReal, identity };
}

async function rootUnchanged(root: BoundRoot): Promise<boolean> {
  const now = await lstatIfPresent(root.real);
  return now !== null && sameFile(now, root.identity);
}

async function isInRootFile(root: BoundRoot, candidateReal: string, handle: FileHandle): Promise<boolean> {
  if (!(await rootUnchanged(root))) return false;
  const again = await resolveExistingWithinRoot(root.real, candidateReal);
  if (again === null) return false;
  const onDisk = await lstatIfPresent(again);
  return onDisk !== null && sameFile(onDisk, await handle.stat({ bigint: true }));
}

/** Opens `relative` under `rootReal` for reading and proves the handle is the in-root file. Null when
 *  missing, outside, or swapped during the call. The caller owns the returned handle. */
export async function openVerifiedWithinRoot(rootReal: string, relative: string, hooks: VerifiedFileHooks = {}): Promise<FileHandle | null> {
  const root = await bindRoot(rootReal);
  if (root === null) return null;
  const candidateReal = await resolveExistingWithinRoot(rootReal, relative);
  if (candidateReal === null) return null;
  await hooks.beforeOpen?.();
  const handle = await openIfPresent(candidateReal, READ_FLAGS);
  if (handle === null) return null;
  try {
    await hooks.afterOpen?.();
    if (await isInRootFile(root, candidateReal, handle)) return handle;
  } catch (err) {
    await handle.close();
    throw err;
  }
  await handle.close();
  return null;
}

/** The staging file's directory, re-resolved, if it is inside the root and holds exactly the opened staging file. */
async function verifiedStagingDir(root: BoundRoot, dirReal: string, staging: string, handle: FileHandle): Promise<string | null> {
  if (!(await rootUnchanged(root))) return null;
  const dirAgain = await resolveExistingWithinRoot(root.real, dirReal);
  if (dirAgain === null) return null;
  const entry = await lstatIfPresent(path.join(dirAgain, staging));
  return entry !== null && sameFile(entry, await handle.stat({ bigint: true })) ? dirAgain : null;
}

async function writeStaging(root: BoundRoot, dirReal: string, staging: string, content: string | Uint8Array, hooks: VerifiedFileHooks): Promise<string> {
  await hooks.beforeOpen?.();
  const handle = await promises.open(path.join(dirReal, staging), CREATE_FLAGS);
  try {
    await hooks.afterOpen?.();
    const stagingDir = await verifiedStagingDir(root, dirReal, staging, handle);
    if (stagingDir === null) throw new Error(`refusing to write: ${dirReal} left the scope during the write`);
    await handle.writeFile(content);
    return stagingDir;
  } finally {
    await handle.close();
  }
}

const stagingNameFor = (leaf: string): string => `${leaf}.${randomBytes(STAGING_SUFFIX_BYTES).toString("hex")}.tmp`;

const removeQuietly = async (absPath: string): Promise<void> => {
  await promises.unlink(absPath).catch(() => {});
};

// The rename's source is the verified staging file, so it can only succeed in the directory that holds
// it — the inode verified above, wherever it has been moved since. A link put in its place makes it fail.
async function renameIntoPlace(stagingDir: string, staging: string, leaf: string, hooks: VerifiedFileHooks): Promise<void> {
  try {
    await hooks.beforeRename?.();
    await renameWithWindowsRetry(path.join(stagingDir, staging), path.join(stagingDir, leaf));
  } catch (err) {
    await removeQuietly(path.join(stagingDir, staging));
    throw err;
  }
}

/** Atomic write of `leaf` into `dirReal` (an already-confined realpath under `rootReal`). The staging
 *  file is verified to sit inside the root before any byte is written, and the rename lands in the
 *  directory holding it, so a parent swapped for a link mid-call makes the write fail. */
export async function writeFileVerifiedInDir(
  rootReal: string,
  dirReal: string,
  leaf: string,
  content: string | Uint8Array,
  hooks: VerifiedFileHooks = {},
): Promise<void> {
  const root = await bindRoot(rootReal);
  if (root === null) throw new Error(`refusing to write: the scope root ${rootReal} is gone`);
  const staging = stagingNameFor(leaf);
  const stagingDir = await writeStaging(root, dirReal, staging, content, hooks).catch(async (err: unknown) => {
    await removeQuietly(path.join(dirReal, staging));
    throw err;
  });
  await renameIntoPlace(stagingDir, staging, leaf, hooks);
}
