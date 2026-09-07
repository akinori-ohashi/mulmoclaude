// `npm pack --json` changed shape between npm 11 and npm 12: an ARRAY of packed
// packages became an OBJECT keyed by package name. The check read `parsed[0]`,
// which is `undefined` on the object — so it saw an empty file list for every
// package and reported each translation as missing. `@mulmobridge/slack` had
// been failing this gate on a tarball that shipped `README.ja.md` all along
// (verified against `npm pack --dry-run`, which listed the file). A gate that is
// permanently red is a gate everyone learns to ignore, so the shapes are pinned.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, packEntry, statusLine, TRANSLATION_RE, type AuditResult, type PackedFile } from "../../../scripts/packages/check-readme-translations.mjs";

const files: PackedFile[] = [{ path: "README.md" }, { path: "README.ja.md" }, { path: "dist/index.js" }];

const UNREADABLE_SHAPES: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["a number", 42],
  ["a string", "text"],
  ["an empty array", []],
  ["an empty object", {}],
  ["an array entry with no files", [{ name: "no-files" }]],
  ["an object entry with no files", { pkg: { name: "no-files" } }],
  // CodeRabbit on #2971: a `files` array whose entries have no string `path`
  // mapped to `[undefined, …]`, which matches no translation name — so the gate
  // failed the package for "the tarball omits this file" when the truth was
  // "npm's output was unreadable", pointing the maintainer at the wrong fix.
  ["a files array of unreadable entries", { pkg: { files: [{}, {}] } }],
  ["a files entry whose path is not a string", { pkg: { files: [{ path: 42 }] } }],
];

const result = (over: Partial<AuditResult>): AuditResult => ({ name: "@scope/pkg", onDiskTranslations: ["README.ja.md"], missing: [], ...over });

const READABLE_SHAPES: [string, unknown][] = [
  ["the array shape (npm <= 11)", [{ name: "@scope/pkg", files }]],
  ["the object-keyed-by-name shape (npm 12)", { "@scope/pkg": { name: "@scope/pkg", files } }],
];

describe("packEntry — whichever shape npm used", () => {
  READABLE_SHAPES.forEach(([label, input]) => {
    // The bug, stated as a test: the object shape used to yield no files at all,
    // so a translation the tarball ships read as missing.
    it(`keeps the file list on ${label}`, () => assert.deepEqual(packEntry(input)?.files, files));
  });

  // An unrecognised shape must be distinguishable from "packed nothing" — the
  // caller rejects on null rather than reporting every translation missing.
  UNREADABLE_SHAPES.forEach(([label, input]) => {
    it(`answers null for ${label}`, () => assert.equal(packEntry(input), null));
  });
});

describe("TRANSLATION_RE", () => {
  it("matches a language suffix, with or without a region", () => {
    ["README.ja.md", "README.fr.md", "README.pt-BR.md", "README.zh-CN.md"].forEach((name) => assert.ok(TRANSLATION_RE.test(name), name));
  });

  it("does not match the canonical README or unrelated files", () => {
    ["README.md", "README.txt", "READMEja.md", "README..md", "CHANGELOG.ja.md", "README.JA.md", "README.pt-br.md"].forEach((name) =>
      assert.ok(!TRANSLATION_RE.test(name), name),
    );
  });
});

// Codex on #2971: the "unrecognised shape" rejection was caught per package and
// only logged, so the gate still exited 0 — and with the sole translated
// package dropped from the roster it even printed "no packages … Nothing to
// check". Reproduced with a fake `npm` emitting `{}`. "Could not read the
// tarball" is a failure of its own, never a pass.
describe("classify — the two ways the gate fails", () => {
  it("separates a missing translation from an unreadable tarball", () => {
    const missing = result({ missing: ["README.ja.md"] });
    const unverified = result({ error: "npm pack --json returned an unrecognised shape" });
    const { missing: gotMissing, unverified: gotUnverified } = classify([result({}), missing, unverified]);
    assert.deepEqual(gotMissing, [missing]);
    assert.deepEqual(gotUnverified, [unverified]);
  });

  it("never counts an unverified package as clean", () => {
    const { missing, unverified } = classify([result({ error: "boom" })]);
    assert.equal(missing.length, 0, "an unread tarball is not a missing-file finding");
    assert.equal(unverified.length, 1, "…but it must still fail the gate");
  });

  it("passes only when every package was read and shipped its translations", () => {
    const { missing, unverified } = classify([result({}), result({ skipped: "private" })]);
    assert.deepEqual([missing.length, unverified.length], [0, 0]);
  });
});

describe("statusLine", () => {
  it("names the outcome, with the error winning over a silent OK", () => {
    assert.equal(statusLine(result({})), "OK");
    assert.equal(statusLine(result({ skipped: "private" })), "skipped (private)");
    assert.equal(statusLine(result({ missing: ["README.ja.md"] })), "MISSING: README.ja.md");
    assert.equal(statusLine(result({ error: "boom" })), "ERROR: boom");
    assert.equal(statusLine(result({ error: "boom", missing: [] })), "ERROR: boom", "an unread tarball must not read as OK");
  });
});

// Codex asked for the end-to-end assertion, and it is the one that matters: the
// unit tests above pin `classify`, but the defect was that nothing CALLED it on
// the error path. This runs the real CLI with a fake `npm` on PATH and asserts
// the process exit code, which is all CI ever looks at.
const SCRIPT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../scripts/packages/check-readme-translations.mjs");

/** Write a stub `npm` into `bin` that prints `packJson` and exits 0. Both forms
 *  are written unconditionally: a shell script for POSIX, and a `.cmd` because
 *  Windows resolves `spawn("npm")` through PATHEXT and cannot execute the
 *  former. The Windows CI job runs this file — `test:coverage` globs two levels
 *  under `test/` — so a POSIX-only fixture is a red job there. */
function writeFakeNpm(bin: string, packJson: string): void {
  writeFileSync(path.join(bin, "npm"), `#!/bin/sh\ncat <<'JSON'\n${packJson}\nJSON\n`);
  chmodSync(path.join(bin, "npm"), 0o755);
  // No batch metacharacters in these fixtures (`{`, `"`, `[`, `:` are literal),
  // so a bare `echo` reproduces the JSON exactly.
  writeFileSync(path.join(bin, "npm.cmd"), `@echo off\r\necho ${packJson}\r\n`);
}

/** Run the real checker with that stub on PATH. Returns the exit code AND the
 *  output: the code alone cannot tell "the checker read our fixture and found a
 *  problem" from "the checker never ran the fixture at all" — both exit 1. That
 *  is exactly how the Windows fixture looked healthy while `spawn("npm")` was
 *  failing with ENOENT on every case. */
function runWithFakeNpm(packJson: string): { code: number; output: string } {
  const bin = mkdtempSync(path.join(tmpdir(), "fake-npm-"));
  try {
    writeFakeNpm(bin, packJson);
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
    const output = execFileSync(process.execPath, [SCRIPT], { env, encoding: "utf8", stdio: "pipe" });
    return { code: 0, output };
  } catch (err) {
    const { status, stdout, stderr } = err as { status?: number; stdout?: string; stderr?: string };
    return { code: typeof status === "number" ? status : -1, output: `${stdout ?? ""}${stderr ?? ""}` };
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

const shipped = (...paths: string[]) => JSON.stringify({ "@mulmobridge/slack": { files: paths.map((filePath) => ({ path: filePath })) } });

const CLI_CASES: { label: string; packJson: string; exitCode: number; says: RegExp }[] = [
  { label: "npm's output cannot be read", packJson: "{}", exitCode: 1, says: /unrecognised shape/ },
  { label: "the tarball genuinely omits a translation", packJson: shipped("README.md"), exitCode: 1, says: /MISSING: README\.ja\.md/ },
  { label: "the tarball ships the translation", packJson: shipped("README.md", "README.ja.md"), exitCode: 0, says: /README\.ja\.md — OK/ },
  // Distinct from the first row: npm answered a shape, but its file entries are
  // unreadable. It must still fail — as unverified, not as a missing file.
  { label: "the file entries cannot be read", packJson: '{"@mulmobridge/slack":{"files":[{},{}]}}', exitCode: 1, says: /unrecognised shape/ },
];

describe("the CLI itself (end to end)", () => {
  CLI_CASES.forEach(({ label, packJson, exitCode, says }) => {
    it(`exits ${exitCode} when ${label}`, () => {
      const { code, output } = runWithFakeNpm(packJson);
      // The message first: it is what proves the fixture was actually read.
      assert.match(output, says, `the checker did not report ${label}`);
      assert.equal(code, exitCode);
    });
  });
});

// The `.cmd` fixture reproduces its JSON with a bare `echo`, which is only exact
// while the payload has no batch metacharacter. This cannot be observed from a
// POSIX machine — a payload containing one would produce a Windows-only failure
// with no local signal — so the constraint is asserted instead of trusted.
describe("the Windows fixture's payloads stay echo-safe", () => {
  const BATCH_METACHARACTERS = /[%^&|<>()]/;

  CLI_CASES.forEach(({ label, packJson }) => {
    it(`"${label}" survives a batch echo verbatim`, () => {
      assert.ok(!BATCH_METACHARACTERS.test(packJson), `${packJson} needs escaping before a .cmd echo can reproduce it`);
    });
  });
});
