// Scan every packages/**/package.json. For each one that has any
// README translation files on disk (README.ja.md, README.fr.md, …),
// verify that the published tarball actually ships them by running
// `npm pack --dry-run --json`.
//
// Usage:
//   node scripts/packages/check-readme-translations.mjs
//
// Exit 0 = clean (every on-disk translation lands in the tarball).
// Exit 1 = at least one translation is on disk but missing from the
//          tarball (e.g. excluded by `.npmignore` or a restrictive
//          `files` array combined with other edge cases).
//
// Motivation: README translations are easy to forget on the publish
// side. npm's default inclusion rules DO already cover `README*.md`
// without an explicit `files` entry, but `.npmignore` or other
// filter config can still drop them silently. Run this before any
// bulk publish as a pre-flight sanity check.

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "packages");

// Match README translations with a BCP-47-ish suffix (ja, ja-JP,
// pt-BR, etc.). README.md itself is excluded — that's the canonical
// one and ships by default.
export const TRANSLATION_RE = /^README\.[a-z]{2}(-[A-Z]{2})?\.md$/;

async function findPackageJsons(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "package.json") out.push(full);
    }
  }
  await walk(root);
  return out;
}

// Run `npm pack --dry-run --json` inside `cwd` and return the array
// of file entries the tarball would contain. The output prints to
// stderr when `--dry-run` is used — parse stdout, which carries the
// JSON.
// The one packed package out of `npm pack --json`, whatever shape npm used.
// npm <= 11 answered an ARRAY with one entry per packed package; npm 12 answers
// an OBJECT keyed by package name. Reading `parsed[0]` on the object yields
// `undefined`, so the previous version of this check saw an empty file list for
// every package and reported each of their translations as missing — the gate
// was red on a tarball that had shipped the file all along.
export function packEntry(parsed) {
  const candidate = Array.isArray(parsed) ? parsed[0] : isRecord(parsed) ? Object.values(parsed)[0] : null;
  if (!isRecord(candidate) || !Array.isArray(candidate.files)) return null;
  // Every entry must carry a string `path`. A `files` array of shapes we cannot
  // read maps to `[undefined, …]`, which compares unequal to every translation
  // name — so the gate would fail the package for "the tarball omits this file"
  // when the truth is "npm's output was unreadable", sending the maintainer to
  // edit a `files` array that was never the problem.
  return candidate.files.every((file) => isRecord(file) && typeof file.path === "string") ? candidate : null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/** The file paths inside `stdout`'s pack result. Throws rather than answering
 *  `[]` when the shape is unreadable — the caller must be able to tell "this
 *  tarball ships nothing" from "we never managed to read this tarball". */
function parsePackedPaths(stdout, cwd) {
  const entry = packEntry(JSON.parse(stdout));
  if (!entry) throw new Error(`npm pack --json returned an unrecognised shape in ${cwd}; cannot verify the tarball`);
  return (entry.files ?? []).map((file) => file.path);
}

/** `npm pack --dry-run --json` in `cwd`, as `{ code, stdout, stderr }`.
 *  `--ignore-scripts` keeps `prepack` hooks (which often run `yarn build` and
 *  pollute stdout with yarn's banner) from corrupting the JSON. */
// Windows ships npm as `npm.cmd`, and two separate things stop a bare
// `spawn("npm")` from reaching it: `spawn` without a shell does not apply
// PATHEXT (ENOENT), and since the CVE-2024-27980 fix Node refuses to execute a
// `.cmd` at all unless a shell is asked for (EINVAL). So Windows needs both the
// explicit name and `shell: true`. The usual objection to `shell: true` —
// interpolating an untrusted value into a command line — does not apply: every
// argument here is a literal constant, and `cwd` is passed as an option rather
// than as part of the command. POSIX keeps the shell-free path unchanged.
const IS_WINDOWS = process.platform === "win32";
const NPM_BIN = IS_WINDOWS ? "npm.cmd" : "npm";
const PACK_ARGS = ["pack", "--dry-run", "--json", "--ignore-scripts"];

async function runPack(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(NPM_BIN, PACK_ARGS, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: IS_WINDOWS });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

async function packedFiles(cwd) {
  const { code, stdout, stderr } = await runPack(cwd);
  if (code !== 0) throw new Error(`npm pack failed in ${cwd} (exit ${code})\n${stderr}`);
  return parsePackedPaths(stdout, cwd);
}

async function auditPackage(packageJsonPath) {
  const dir = path.dirname(packageJsonPath);
  const dirEntries = await readdir(dir).catch(() => []);
  const onDiskTranslations = dirEntries.filter((name) => TRANSLATION_RE.test(name));
  if (onDiskTranslations.length === 0) return { name: null, onDiskTranslations: [], missing: [] };

  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  // `npm pack` refuses to run on a private package without explicit
  // flags — treat private packages as "not published" and skip.
  if (pkg.private) return { name: pkg.name ?? path.basename(dir), onDiskTranslations, missing: [], skipped: "private" };

  const packed = await packedFiles(dir);
  const missing = onDiskTranslations.filter((name) => !packed.includes(name));
  return { name: pkg.name ?? path.basename(dir), onDiskTranslations, missing };
}

/** Audit every package, keeping only those that have translations on disk.
 *  A package that could not be VERIFIED is kept too, carrying `error` — the
 *  gate has to fail on it, not drop it from the roster. */
async function auditAll(packageJsons) {
  const results = [];
  for (const packageJsonPath of packageJsons) {
    try {
      const result = await auditPackage(packageJsonPath);
      if (result.onDiskTranslations.length > 0) results.push({ ...result, packageJsonPath });
    } catch (err) {
      const dir = path.dirname(packageJsonPath);
      const onDisk = (await readdir(dir).catch(() => [])).filter((name) => TRANSLATION_RE.test(name));
      results.push({
        name: path.basename(dir),
        onDiskTranslations: onDisk,
        missing: [],
        error: err instanceof Error ? err.message : String(err),
        packageJsonPath,
      });
    }
  }
  return results;
}

/** One roster line per package: what it has on disk and how it ended up. */
export function statusLine(result) {
  if (result.error) return `ERROR: ${result.error}`;
  if (result.skipped) return `skipped (${result.skipped})`;
  return result.missing.length === 0 ? "OK" : `MISSING: ${result.missing.join(", ")}`;
}

/** Split a roster into the two reasons the gate can fail. `unverified` is
 *  deliberately separate from `missing`: "the tarball does not ship this file"
 *  and "we could not read the tarball at all" need different fixes, and
 *  collapsing the second into a pass is how a shape change silences the gate. */
export function classify(results) {
  return {
    missing: results.filter((result) => !result.error && result.missing.length > 0),
    unverified: results.filter((result) => result.error),
  };
}

function report(results) {
  const { missing, unverified } = classify(results);
  console.log(`[check:readmes] scanned ${results.length} packages with README translations:`);
  results.forEach((result) => console.log(`  ${result.name} — ${result.onDiskTranslations.join(", ")} — ${statusLine(result)}`));
  if (missing.length === 0 && unverified.length === 0) return 0;

  if (missing.length > 0) {
    console.error(`\n[check:readmes] FAIL — ${missing.length} package(s) ship README translations on disk that are excluded from the tarball.`);
    console.error(`Check .npmignore and the 'files' array in the package.json of each flagged package.`);
  }
  if (unverified.length > 0) {
    console.error(`\n[check:readmes] FAIL — ${unverified.length} package(s) could not be verified at all.`);
    console.error(`This is not "the translations are fine" — the tarball was never read. Check the npm pack output above.`);
  }
  return 1;
}

async function main() {
  const results = await auditAll(await findPackageJsons(PACKAGES_ROOT));
  if (results.length === 0) {
    console.log(`[check:readmes] no packages have README translations on disk. Nothing to check.`);
    return 0;
  }
  return report(results);
}

// Only run the CLI when invoked directly, so tests can import the helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main();
}
