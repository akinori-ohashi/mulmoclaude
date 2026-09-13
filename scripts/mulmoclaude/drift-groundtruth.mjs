#!/usr/bin/env node
// Judges `drift.mjs`'s export parser against an external authority instead of
// against itself: every local dist entry in the scan set is imported, and
// `Object.keys(namespace)` — the names Node actually exposes — is compared with what
// `collectEntryNames` reports. Two live false negatives were found this way that no
// amount of reading the parser had surfaced (`@mulmoclaude/core`'s `./plugin-vue`
// entry reported ZERO of its ten names, on both sides, which reads as a match).
//
// Deliberately NOT part of `yarn test`: importing built code runs its side effects.
// Run it by hand after touching the parser — `node scripts/mulmoclaude/drift-groundtruth.mjs`
// — and expect every entry exact.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { discoverWorkspaceLibraries, entryTargets, collectEntryNames } from "./drift.mjs";

const JS_ENTRY = /\.(?:js|mjs)$/;

const compareEntryAgainstRuntime = async ({ root, dir, entryPath }) => {
  let namespace;
  try {
    namespace = await import(pathToFileURL(path.join(root, dir, entryPath)).href);
  } catch (error) {
    return { imported: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const read = async (rel) => ({ source: await readFile(path.join(root, dir, rel), "utf8").catch(() => null), retryable: false });
  const parsed = await collectEntryNames({ entryPath, read });
  const exposed = Object.keys(namespace);
  return {
    imported: true,
    missed: exposed.filter((name) => !parsed.names.has(name)),
    invented: [...parsed.names].filter((name) => !exposed.includes(name)),
    opaque: parsed.opaque,
  };
};

const main = async ({ root = process.cwd() } = {}) => {
  const libraries = await discoverWorkspaceLibraries({ root });
  const findings = [];
  let compared = 0;
  let unimportable = 0;
  for (const library of libraries) {
    for (const [subpath, entryPath] of entryTargets(library.pkg)) {
      if (entryPath === null || entryPath.includes("*") || !JS_ENTRY.test(entryPath)) continue;
      const result = await compareEntryAgainstRuntime({ root, dir: library.dir, entryPath });
      if (!result.imported) {
        unimportable += 1;
        continue;
      }
      compared += 1;
      if (result.missed.length === 0 && result.invented.length === 0) continue;
      findings.push(
        `  ✖ ${library.name} ${subpath} (opaque=${result.opaque})\n     missed: ${result.missed.join(", ") || "-"}\n     invented: ${result.invented.join(", ") || "-"}`,
      );
    }
  }
  console.log(`[drift:groundtruth] ${compared} entry(ies) imported, ${compared - findings.length} exact, ${unimportable} could not be imported (side effects)`);
  findings.forEach((finding) => console.log(finding));
  return findings.length === 0 ? 0 : 1;
};

process.exitCode = await main();
