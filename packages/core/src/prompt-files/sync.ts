// Writes each package's prompt reference files under `<root>/<package>/`.
// Only the packages passed in are touched: a MulmoTerminal root is shared by
// every instance, and one with a different plugin set must not delete the
// others' files.

import { existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promptFilesSubdir, readPromptSplit } from "./split";

export interface PromptFilesSource {
  /** Package name supplied by the HOST (never read from the definition), so
   *  one plugin cannot claim another's directory. */
  packageName: string;
  definition: unknown;
}

export interface PromptFilesSyncResult {
  /** package name → its subdir under the root, for every package written. */
  written: ReadonlyMap<string, string>;
  /** packages skipped, with why — their tools keep the full `prompt`. */
  problems: { packageName: string; problem: string }[];
}

type PackageFiles = { files: Record<string, string> } | { problem: string };

function mergeFiles(target: Record<string, string>, files: Readonly<Record<string, string>>): string | null {
  for (const [name, content] of Object.entries(files)) {
    if (Object.hasOwn(target, name) && target[name] !== content) return `two tools declare '${name}' with different content`;
    target[name] = content;
  }
  return null;
}

/** Every file each package declares across its tools. */
export function collectPackageFiles(sources: readonly PromptFilesSource[]): Map<string, PackageFiles> {
  const byPackage = new Map<string, PackageFiles>();
  for (const { packageName, definition } of sources) {
    const split = readPromptSplit(definition);
    if (!split) continue;
    const current = byPackage.get(packageName) ?? { files: {} };
    if (!("files" in current)) continue;
    const problem = mergeFiles(current.files, split.files);
    byPackage.set(packageName, problem ? { problem } : current);
  }
  return byPackage;
}

function writeStaging(staging: string, files: Readonly<Record<string, string>>): void {
  mkdirSync(staging, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(staging, ...name.split("/"));
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

/** Swap `staging` in for `target`, keeping the old copy until the swap
 *  lands — another instance sharing the root may be reading it. */
function swapIn(staging: string, target: string): void {
  const backup = `${target}.old-${randomUUID()}`;
  const hadTarget = existsSync(target);
  if (hadTarget) renameSync(target, backup);
  try {
    renameSync(staging, target);
  } catch (err) {
    if (hadTarget) renameSync(backup, target);
    throw err;
  }
  rmSync(backup, { recursive: true, force: true });
}

/** Refuse when the root or a scope directory is a symlink: the swap renames
 *  and deletes `<scope>/<name>`, which through a link pointing outside the
 *  root would hit an unrelated directory. */
function assertNoSymlinkedParent(root: string, subdir: string): void {
  const segments = subdir.split("/").slice(0, -1);
  const parents = segments.map((_, index) => path.join(root, ...segments.slice(0, index + 1)));
  for (const parent of [root, ...parents]) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error(`${parent} is a symlink`);
  }
}

/** Write into a fresh sibling directory, then swap it in, so a reader never
 *  sees a half-written package. */
function writePackageDir(root: string, subdir: string, files: Readonly<Record<string, string>>): void {
  assertNoSymlinkedParent(root, subdir);
  const target = path.join(root, ...subdir.split("/"));
  const staging = `${target}.tmp-${randomUUID()}`;
  try {
    writeStaging(staging, files);
    swapIn(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function syncPromptFiles(root: string, sources: readonly PromptFilesSource[]): PromptFilesSyncResult {
  const written = new Map<string, string>();
  const problems: PromptFilesSyncResult["problems"] = [];
  for (const [packageName, entry] of collectPackageFiles(sources)) {
    const subdir = promptFilesSubdir(packageName);
    if (!subdir) problems.push({ packageName, problem: "package name is not a safe directory name" });
    else if ("problem" in entry) problems.push({ packageName, problem: entry.problem });
    else {
      try {
        writePackageDir(root, subdir, entry.files);
        written.set(packageName, subdir);
      } catch (err) {
        problems.push({ packageName, problem: `could not write ${path.join(root, subdir)}: ${String(err)}` });
      }
    }
  }
  return { written, problems };
}
