// The broker's start marker is written INSIDE the sandbox, into a directory the
// agent can write. A plain write there follows whatever is already at the path,
// so a symlink planted on it would be truncated — and on the reading side a
// planted entry would report a broker that never ran as having started, which
// is the one thing this signal is asked to be right about (Codex review on
// #2932).
//
// No privilege boundary is crossed either way — the broker runs as the same uid
// in the same container — but a write that follows an attacker-placed link is
// wrong regardless, and refusing costs nothing: the HTTP beacon covers the
// signal when the file cannot be created.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeStartMarker } from "../../server/agent/mcp-start-beacon.mjs";
import { markerHolds, MARKER_MAX_BYTES } from "../../server/agent/backend/claude-code.js";

// Windows has no `O_NOFOLLOW`, and `symlinkSync` there needs a privilege the
// runner does not have — so the symlink cases are POSIX-only rather than
// failing for a reason that is not about this code.
const SYMLINK_SKIP = platform() === "win32" ? "symlinks need privilege on Windows, and O_NOFOLLOW does not exist there" : false;
const FIFO_SKIP = platform() === "win32" ? "no mkfifo, and a named pipe is not reachable at a path like this" : false;

/** How long the child gets before the parent calls the open blocked. Generous
 *  next to the sub-second answer a working `O_NONBLOCK` gives, because the
 *  child pays a cold `tsx` start first. */
const FIFO_CHILD_TIMEOUT_MS = 20_000;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A one-line program that calls the REAL `markerHolds` on `markerPath`. The
 *  point is to exercise the shipped function, not a copy of its open flags. */
function markerHoldsProbe(markerPath: string): string {
  const moduleUrl = pathToFileURL(path.join(REPO_ROOT, "server", "agent", "backend", "claude-code.ts")).href;
  return [
    `const { markerHolds } = await import(${JSON.stringify(moduleUrl)});`,
    `process.stdout.write(markerHolds(${JSON.stringify(markerPath)}, "spawn-abc") ? "true" : "false");`,
  ].join("\n");
}

let root = "";

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "mulmoclaude-marker-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("writeStartMarker", () => {
  it("writes the spawn id when the path is free", () => {
    const marker = path.join(root, "fresh");
    writeStartMarker(marker, "spawn-1");
    assert.equal(readFileSync(marker, "utf-8"), "spawn-1");
  });

  it("refuses a path that already holds a file, rather than overwriting it", () => {
    const marker = path.join(root, "occupied");
    writeFileSync(marker, "someone else's content");
    assert.throws(() => writeStartMarker(marker, "spawn-2"));
    assert.equal(readFileSync(marker, "utf-8"), "someone else's content");
  });

  // The case the hardening exists for: the write must not travel down a link
  // the sandboxed agent planted.
  it("refuses a symlink and leaves its target untouched", { skip: SYMLINK_SKIP }, () => {
    const victim = path.join(root, "victim");
    writeFileSync(victim, "precious");
    const marker = path.join(root, "planted-link");
    symlinkSync(victim, marker);
    assert.throws(() => writeStartMarker(marker, "spawn-3"));
    assert.equal(readFileSync(victim, "utf-8"), "precious");
  });

  it("refuses a symlink even when its target does not exist yet", { skip: SYMLINK_SKIP }, () => {
    const target = path.join(root, "not-there-yet");
    const marker = path.join(root, "dangling-link");
    symlinkSync(target, marker);
    assert.throws(() => writeStartMarker(marker, "spawn-4"));
    assert.equal(existsSync(target), false);
  });

  it("refuses a directory at the marker path", () => {
    const marker = path.join(root, "a-directory");
    mkdirSync(marker);
    assert.throws(() => writeStartMarker(marker, "spawn-5"));
  });
});

// What the host will accept as "this broker started". The marker sits in a
// directory the sandboxed agent can write, so the read has to rule out both a
// symlink and a file merely pre-created at the path (Codex review on #2932).
//
// It is not, and cannot be, unforgeable: the marker path, the spawn id and the
// bearer token all live in the per-session MCP config inside the same mount, so
// anything that can plant the file can read what to put in it. Nothing acts on
// this signal — it labels a log line — so the bar is "not wrong by accident".
describe("markerHolds", () => {
  it("accepts a marker holding this spawn's id", () => {
    const marker = path.join(root, "accept");
    writeStartMarker(marker, "spawn-abc");
    assert.equal(markerHolds(marker, "spawn-abc"), true);
  });

  it("rejects a marker left by a different spawn", () => {
    const marker = path.join(root, "other-spawn");
    writeStartMarker(marker, "spawn-abc");
    assert.equal(markerHolds(marker, "spawn-xyz"), false);
  });

  // The scenario the content check exists for: touch the path before the broker
  // launches and the preload then refuses to write it, so an existence-only
  // check would report a broker that never ran.
  it("rejects a file pre-created at the path", () => {
    const marker = path.join(root, "pre-created");
    writeFileSync(marker, "");
    assert.equal(markerHolds(marker, "spawn-abc"), false);
  });

  it("rejects a symlink even when its target holds the right id", { skip: SYMLINK_SKIP }, () => {
    const target = path.join(root, "right-content");
    writeFileSync(target, "spawn-abc");
    const marker = path.join(root, "link-to-right-content");
    symlinkSync(target, marker);
    assert.equal(markerHolds(marker, "spawn-abc"), false);
  });

  it("rejects a missing marker", () => {
    assert.equal(markerHolds(path.join(root, "nope"), "spawn-abc"), false);
  });

  // The sharpest of the planted-entry cases, and the only one that hangs rather
  // than misleads: opening a FIFO waits for a writer forever, and this open is
  // synchronous, so it freezes the event loop rather than the turn. Reproduced
  // before the fix — `openSync` never returned and a pending timer never fired
  // (Codex review on #2932).
  //
  // Run in a CHILD process, with the deadline enforced by the parent. `node:test`
  // cannot interrupt a synchronous blocking callback, so an in-process version
  // of this test does not fail when the fix is missing — it hangs the whole
  // runner, reporting zero tests (CodeRabbit review on #2932, which proved the
  // point with a standalone script). A killed child is an assertion; a hung
  // runner is not.
  it("rejects a FIFO without blocking", { skip: FIFO_SKIP, timeout: FIFO_CHILD_TIMEOUT_MS * 2 }, () => {
    const fifo = path.join(root, "planted-fifo");
    execFileSync("mkfifo", [fifo]);

    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", markerHoldsProbe(fifo)], {
      timeout: FIFO_CHILD_TIMEOUT_MS,
      encoding: "utf-8",
      cwd: REPO_ROOT,
    });

    assert.equal(child.signal, null, `the open blocked: the child had to be killed after ${FIFO_CHILD_TIMEOUT_MS}ms`);
    assert.equal(child.status, 0, `child failed: ${child.stderr}`);
    assert.equal(child.stdout.trim(), "false");
  });

  it("rejects a directory", () => {
    const marker = path.join(root, "dir-marker");
    mkdirSync(marker);
    assert.equal(markerHolds(marker, "spawn-abc"), false);
  });

  it("tolerates surrounding whitespace from the write", () => {
    const padded = path.join(root, "padded");
    writeFileSync(padded, "  spawn-abc\n");
    assert.equal(markerHolds(padded, "spawn-abc"), true);
  });

  // The cap is enforced by the READ — `readSync` into a fixed
  // `Buffer.alloc(MARKER_MAX_BYTES)` — not by slicing afterwards, which is what
  // `docs/large-file-reading.md` warns about and what Codex flagged on #2932.
  //
  // Stated plainly: that bound is NOT observable through this function's return
  // value, and these two cases do not prove it. An attempt to build a case that
  // discriminates (a sparse file past `kStringMaxLength` whose first bytes hold
  // the id) fails for an unrelated and correct reason — `ftruncate` zero-fills,
  // `trim()` does not strip NUL, so such a file is rejected either way. Every
  // oversized input SHOULD be rejected, so no input separates the two
  // implementations by result. The bound is structural; these pin the
  // behaviour around it.
  it("refuses a marker whose id sits past the byte cap", () => {
    const huge = path.join(root, "huge");
    writeFileSync(huge, `${"x".repeat(10 * 1024 * 1024)}spawn-abc`);
    assert.equal(markerHolds(huge, "spawn-abc"), false);
  });

  it("refuses a marker padded past the cap even when it starts with the id", () => {
    const padded = path.join(root, "padded-past-cap");
    writeFileSync(padded, `spawn-abc${"x".repeat(10 * 1024 * 1024)}`);
    assert.equal(markerHolds(padded, "spawn-abc"), false);
  });

  // The variant the two cases above miss, and the reason size is now checked
  // rather than only the read being bounded: pad with WHITESPACE inside the cap
  // and `trim()` strips it, so everything past the cap goes unseen and a huge
  // file reads as a valid marker. The cases above pad with `x`, which trim
  // keeps — so they passed either way and gave false assurance (CodeRabbit
  // review on #2932).
  it("refuses an oversized marker whose first bytes are the id plus whitespace", () => {
    const sneaky = path.join(root, "whitespace-padded");
    // The whitespace must fill the cap EXACTLY, so the window the read sees
    // trims down to the id and nothing of the payload lands inside it. Padding
    // that stops short leaves junk in the window and is rejected anyway —
    // which is how the first version of this test passed without the fix.
    writeFileSync(sneaky, `spawn-abc`.padEnd(MARKER_MAX_BYTES, " ") + "x".repeat(1024 * 1024));
    assert.equal(markerHolds(sneaky, "spawn-abc"), false);
  });

  // The boundary itself: a marker exactly at the cap is still a marker.
  it("accepts a marker sized exactly at the cap", () => {
    const exact = path.join(root, "exactly-at-cap");
    writeFileSync(exact, "spawn-abc".padEnd(MARKER_MAX_BYTES, " "));
    assert.equal(markerHolds(exact, "spawn-abc"), true);
  });
});
