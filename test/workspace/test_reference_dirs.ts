// Non-string fields in the hand-edited `config/reference-dirs.json`.
//
// These used to reach the validators via `String(value)`, so an object arrived
// as the literal "[object Object]" — usable as a label, and echoed back in the
// error text as if the user had typed it.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { homedir } from "os";
import {
  buildReferenceDirsPrompt,
  loadReferenceDirs,
  planReferenceDirs,
  referenceDirMountArgs,
  validateReferenceDirs,
} from "../../server/workspace/reference-dirs.ts";
import { log } from "../../server/system/logger/index.ts";
import { makeTempDir } from "../helpers/tempDir.js";

function tmpRoot(): string {
  const dir = makeTempDir("reference-dirs-");
  mkdirSync(path.join(dir, "config"), { recursive: true });
  return dir;
}

function writeConfig(root: string, data: unknown): void {
  writeFileSync(path.join(root, "config", "reference-dirs.json"), JSON.stringify(data), "utf-8");
}

const targets: string[] = [];

/** A real, mountable directory — entries pointing at one survive validation.
 *  Created under $HOME, not `tmpdir()`: on macOS that resolves under `/var`,
 *  which `SYSTEM_BLOCKED_PREFIXES` rejects, so every entry would be dropped for
 *  the wrong reason. */
function realDir(): string {
  const dir = mkdtempSync(path.join(homedir(), ".mulmoclaude-test-ref-"));
  targets.push(dir);
  return dir;
}

after(() => {
  for (const dir of targets) rmSync(dir, { recursive: true, force: true });
});

describe("loadReferenceDirs — non-string fields", () => {
  it("falls back to the basename when label is an object", () => {
    const root = tmpRoot();
    const target = realDir();
    writeConfig(root, [{ hostPath: target, label: { text: "nope" } }]);
    const entries = loadReferenceDirs(root);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.ok(entry);
    assert.equal(entry.label, path.basename(target));
    assert.doesNotMatch(entry.label, /\[object Object\]/);
  });

  it("falls back to the basename when label is an array", () => {
    const root = tmpRoot();
    const target = realDir();
    writeConfig(root, [{ hostPath: target, label: ["a", "b"] }]);
    const entries = loadReferenceDirs(root);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.ok(entry);
    assert.equal(entry.label, path.basename(target));
  });

  it("keeps a string label as-is", () => {
    const root = tmpRoot();
    const target = realDir();
    writeConfig(root, [{ hostPath: target, label: "docs" }]);
    const entries = loadReferenceDirs(root);
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.ok(entry);
    assert.equal(entry.label, "docs");
  });

  it("rejects an entry whose hostPath is an object", () => {
    const root = tmpRoot();
    writeConfig(root, [{ hostPath: { dir: "/tmp" }, label: "x" }]);
    assert.deepEqual(loadReferenceDirs(root), []);
  });
});

describe("system directory blocklist — per platform", () => {
  /** The system dir this OS is expected to block. `null` means we have nothing
   *  reliable to assert on (a Windows box exposing neither SystemRoot nor
   *  windir), so those cases skip rather than assert something false. */
  const blockedSystemDir = (): string | null => {
    if (process.platform === "win32") return process.env.SystemRoot ?? process.env.windir ?? null;
    return "/etc";
  };

  const NO_SYSTEM_DIR = "no system dir to assert on (Windows without SystemRoot/windir)";

  const isBlocked = (hostPath: string): boolean => "error" in validateReferenceDirs([{ hostPath, label: "x" }]);

  it("blocks this platform's system directory", (ctx) => {
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    assert.ok(isBlocked(dir), `expected ${dir} to be blocked`);
  });

  it("blocks a subdirectory of it too", (ctx) => {
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    const sub = path.join(dir, "sub");
    assert.ok(isBlocked(sub), `expected ${sub} to be blocked`);
  });

  it("does NOT block a sibling whose name merely starts the same way", (ctx) => {
    // `/etc-backup` must not be swallowed by `/etc`'s subtree — that is what
    // the `+ path.sep` guard in isAtOrUnder buys.
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    const sibling = `${dir}-backup`;
    assert.ok(!isBlocked(sibling), `expected ${sibling} to validate`);
  });

  it("blocks the lowercase spelling on Windows (case-insensitive filesystem)", (ctx) => {
    // POSIX filesystems really are case-sensitive, so there is nothing to assert.
    if (process.platform !== "win32") {
      ctx.skip("win32 only");
      return;
    }
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    assert.ok(isBlocked(dir.toLowerCase()), `expected ${dir.toLowerCase()} to be blocked`);
  });
});

describe("validateReferenceDirs — error text", () => {
  it("does not echo [object Object] back as the offending path", () => {
    const result = validateReferenceDirs([{ hostPath: { nested: true } }]);
    assert.ok("error" in result);
    assert.doesNotMatch(result.error, /\[object Object\]/);
  });

  it("still reports a genuine string path in the error", () => {
    // The filesystem root is blocked on every platform, so this test says
    // nothing about which system dirs a given OS blocks — see the
    // platform-specific suite below for that.
    const blocked = path.parse(path.resolve(".")).root;
    const result = validateReferenceDirs([{ hostPath: blocked }]);
    assert.ok("error" in result);
    assert.ok(result.error.includes(blocked), `expected the error to echo ${blocked}, got: ${result.error}`);
  });

  // The wording is the HTTP response body, so it is pinned verbatim: the
  // generic `validateEntryList` behind this wrapper must not reword it.
  it("reports a non-array input", () => {
    assert.deepEqual(validateReferenceDirs("/tmp"), { error: "expected an array" });
  });

  it("names the offending entry by index", () => {
    const result = validateReferenceDirs([{ hostPath: path.join(homedir(), "docs"), label: "docs" }, { hostPath: "relative/path" }]);
    assert.deepEqual(result, { error: 'entry 1: invalid or blocked path "relative/path"' });
  });

  it("accepts exactly 20 entries", () => {
    const result = validateReferenceDirs(capCandidates(20));
    assert.ok(!("error" in result), `expected 20 entries to pass, got: ${JSON.stringify(result)}`);
    assert.equal(result.entries.length, 20);
  });

  it("rejects 21 entries with the cap in the message", () => {
    assert.deepEqual(validateReferenceDirs(capCandidates(21)), { error: "too many entries (max 20)" });
  });
});

/** Absolute, non-sensitive, uniquely-labelled paths. They need not exist —
 *  `validateReferenceDirs` checks shape, not the filesystem. */
function capCandidates(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, i) => ({
    hostPath: path.join(homedir(), `mulmoclaude-cap-${i}`),
    label: `cap-${i}`,
  }));
}

// The mount args and the system prompt derive from the SAME entry list and used
// to disagree: an entry that could not be mounted was still named to the agent
// as a readable container path (#3194). That is worse than the equivalent
// divergence on `/api/sandbox` — that one misleads a human who can go and look,
// this one misleads the agent, which acts on it.
describe("planReferenceDirs — the prompt may only name what is reachable", () => {
  const scratch = (): string => makeTempDir("reference-dirs-plan-");

  const promptLines = (prompt: string): string[] => prompt.split("\n").filter((line) => line.startsWith("- "));

  it("under Docker, an inexpressible path is neither mounted nor offered", () => {
    const root = scratch();
    const ok = path.join(root, "ok");
    // Only a path holding BOTH a colon and a comma defeats every docker flag.
    const inexpressible = path.join(root, "bad:with,both");
    mkdirSync(ok, { recursive: true });
    mkdirSync(inexpressible, { recursive: true });
    const entries = [
      { hostPath: ok, label: "ok" },
      { hostPath: inexpressible, label: "bad" },
    ];

    const plan = planReferenceDirs(entries, true, "linux");
    assert.deepEqual(
      plan.available.map((entry) => entry.label),
      ["ok"],
    );
    assert.deepEqual(
      plan.skipped.map(({ entry }) => entry.label),
      ["bad"],
    );

    const lines = promptLines(buildReferenceDirsPrompt(entries, true, "linux"));
    assert.equal(lines.length, 1, "the agent is told about exactly the one that mounted");
    assert.match(lines[0] ?? "", /— ok$/);
  });

  it("under Docker, a directory that no longer exists is neither mounted nor offered", () => {
    const root = scratch();
    const entries = [{ hostPath: path.join(root, "gone"), label: "gone" }];
    assert.deepEqual(planReferenceDirs(entries, true, "linux").available, []);
    assert.equal(buildReferenceDirsPrompt(entries, true, "linux"), "", "no section at all when nothing is reachable");
  });

  it("the mount arguments and the prompt agree entry for entry", () => {
    const root = scratch();
    const ok = path.join(root, "ok");
    mkdirSync(ok, { recursive: true });
    const entries = [
      { hostPath: ok, label: "ok" },
      { hostPath: path.join(root, "gone"), label: "gone" },
      { hostPath: path.join(root, "bad:with,both"), label: "bad" },
    ];
    mkdirSync(path.join(root, "bad:with,both"), { recursive: true });

    const plan = planReferenceDirs(entries, true, "linux");
    const mountedTargets = plan.args.filter((arg) => arg !== "-v" && arg !== "--mount").length;
    assert.equal(mountedTargets, plan.available.length, "one mount per available entry");
    assert.equal(promptLines(buildReferenceDirsPrompt(entries, true, "linux")).length, plan.available.length);
  });

  // The two skips are not the same news. A directory the user deleted is
  // ordinary; a path no docker flag can carry will never work until it is
  // renamed, so it keeps the `warn` it had before both became one code path.
  it("distinguishes a missing directory from an unmountable one", () => {
    const root = scratch();
    const unmountable = path.join(root, "bad:with,both");
    mkdirSync(unmountable, { recursive: true });
    const entries = [
      { hostPath: path.join(root, "gone"), label: "gone" },
      { hostPath: unmountable, label: "bad" },
    ];

    const { skipped } = planReferenceDirs(entries, true, "linux");
    assert.deepEqual(
      skipped.map(({ entry, kind }) => [entry.label, kind]),
      [
        ["gone", "missing"],
        ["bad", "unmountable"],
      ],
    );
  });

  // Pinning `kind` alone is not enough: it is the intermediate value, and the
  // thing that regressed was the DISPATCH. A test over the discriminator stays
  // green if the log site is changed to always-info, which is exactly how the
  // regression got in. So assert the levels the spawn path actually writes.
  it("writes unmountable at warn and missing at info", () => {
    const root = scratch();
    const unmountable = path.join(root, "bad:with,both");
    mkdirSync(unmountable, { recursive: true });
    const entries = [
      { hostPath: path.join(root, "gone"), label: "gone" },
      { hostPath: unmountable, label: "bad" },
    ];

    const originalInfo = log.info;
    const originalWarn = log.warn;
    const info: string[] = [];
    const warn: string[] = [];
    log.info = (_namespace, _message, data) => void info.push(String((data as { path?: string } | undefined)?.path ?? ""));
    log.warn = (_namespace, _message, data) => void warn.push(String((data as { path?: string } | undefined)?.path ?? ""));
    try {
      referenceDirMountArgs(entries, "linux");
    } finally {
      log.info = originalInfo;
      log.warn = originalWarn;
    }

    assert.deepEqual(info, [path.join(root, "gone")], "a directory that went away is ordinary news");
    assert.deepEqual(warn, [unmountable], "a path that can never mount until renamed is not");
  });

  // Without Docker there is no mount at all: the agent reads the host path
  // directly, so a path docker could not express is perfectly reachable.
  it("without Docker, a colon-and-comma path is still offered", () => {
    const root = scratch();
    const awkward = path.join(root, "fine:without,docker");
    mkdirSync(awkward, { recursive: true });
    const entries = [{ hostPath: awkward, label: "awkward" }];

    assert.deepEqual(
      planReferenceDirs(entries, false, "linux").available.map((entry) => entry.label),
      ["awkward"],
    );
    assert.equal(promptLines(buildReferenceDirsPrompt(entries, false, "linux")).length, 1);
  });

  it("without Docker, a directory that no longer exists is still dropped", () => {
    const root = scratch();
    const entries = [{ hostPath: path.join(root, "gone"), label: "gone" }];
    assert.deepEqual(planReferenceDirs(entries, false, "linux").available, []);
    assert.equal(buildReferenceDirsPrompt(entries, false, "linux"), "");
  });
});
