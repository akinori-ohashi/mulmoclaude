// Tests for `server/system/secrets.ts` — the store behind Settings' API-key
// field (#871).
//
// Three things here are load-bearing rather than cosmetic: the stored value
// wins over the shell (that precedence is the whole point — a stale `export`
// silently beating what the user just typed is the trap), the value it
// replaced is remembered so clearing hands the key back instead of leaving
// the app keyless until a restart, and a value that cannot go into
// `process.env` safely is refused rather than trimmed into shape.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  applyStoredSecrets,
  deleteStoredSecret,
  isSecretKey,
  MAX_SECRET_LENGTH,
  readStoredSecret,
  secretFilePath,
  secretSource,
  secretsDir,
  validateSecretValue,
  writeStoredSecret,
} from "../../server/system/secrets.js";

const KEY = "GEMINI_API_KEY";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mulmoclaude-secrets-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("isSecretKey", () => {
  it("accepts only the keys Settings manages", () => {
    assert.equal(isSecretKey(KEY), true);
    // The file path is built from this, so anything else must not pass.
    assert.equal(isSecretKey("../../.ssh/id_rsa"), false);
    assert.equal(isSecretKey("PATH"), false);
    assert.equal(isSecretKey(undefined), false);
    assert.equal(isSecretKey(42), false);
  });
});

describe("validateSecretValue", () => {
  it("trims and accepts an ordinary key", () => {
    assert.deepEqual(validateSecretValue("  AIzaExample  "), { ok: true, value: "AIzaExample" });
  });

  it("refuses an empty or whitespace-only value", () => {
    assert.deepEqual(validateSecretValue(""), { ok: false, reason: "empty" });
    assert.deepEqual(validateSecretValue("   \n "), { ok: false, reason: "empty" });
  });

  it("refuses a value carrying a line break or control character", () => {
    // This lands in `process.env` and is inherited by every child process,
    // where a second line is not cosmetic.
    assert.deepEqual(validateSecretValue("AIza\nPATH=/evil"), { ok: false, reason: "control-characters" });
    assert.deepEqual(validateSecretValue("AIza\tkey"), { ok: false, reason: "control-characters" });
    // DEL and C1 as well as C0 — U+009B is CSI, and this value ends up in log
    // lines and in every child process's environment.
    assert.deepEqual(validateSecretValue("AIza\u007f"), { ok: false, reason: "control-characters" });
    assert.deepEqual(validateSecretValue("AIza\u009b31m"), { ok: false, reason: "control-characters" });
  });

  it("refuses a value past the cap", () => {
    assert.deepEqual(validateSecretValue("A".repeat(MAX_SECRET_LENGTH + 1)), { ok: false, reason: "too-long" });
    assert.equal(validateSecretValue("A".repeat(MAX_SECRET_LENGTH)).ok, true);
  });
});

describe("writeStoredSecret / readStoredSecret", () => {
  it("round-trips a value", () => {
    writeStoredSecret(KEY, "AIzaExample", home);
    assert.equal(readStoredSecret(KEY, home), "AIzaExample");
  });

  // Windows does not carry POSIX modes: Node maps only the read-only bit, so a
  // writable file reads back as 0o666 whatever mode it was created with. The
  // requested 0o600 is therefore a POSIX guarantee, and asserting it everywhere
  // fails on a platform where it cannot be true (#3251).
  it("writes owner-only, in a directory nobody else can list", (testCtx) => {
    if (process.platform === "win32") {
      testCtx.skip("requires POSIX permissions — Windows ignores the mode; see the location test below");
      return;
    }
    writeStoredSecret(KEY, "AIzaExample", home);
    assert.equal(statSync(secretFilePath(KEY, home)).mode & 0o777, 0o600);
    assert.equal(statSync(secretsDir(home)).mode & 0o777, 0o700);
  });

  // What holds on EVERY platform, and the only protection Windows has here: the
  // secret lives under the user's own profile directory, whose ACL it inherits.
  // Pinned separately so the Windows skip above does not leave the store with
  // nothing asserting where it writes.
  it("writes inside the given home, never beside the workspace", () => {
    writeStoredSecret(KEY, "AIzaExample", home);
    const written = secretFilePath(KEY, home);
    assert.equal(path.relative(home, written).startsWith(".."), false, "the secret must stay under the home it was given");
    assert.equal(path.dirname(written), secretsDir(home));
    assert.equal(statSync(written).isFile(), true);
  });

  it("reads as absent when there is no file", () => {
    assert.equal(readStoredSecret(KEY, home), undefined);
  });

  it("reads as absent when the file holds something unusable", () => {
    // A hand-edited file must not be able to put a control character into
    // `process.env` by a route the UI refuses.
    mkdirSync(secretsDir(home), { recursive: true });
    writeFileSync(secretFilePath(KEY, home), "AIza\nPATH=/evil");
    assert.equal(readStoredSecret(KEY, home), undefined);
  });

  it("reads as absent when the path is a directory", () => {
    mkdirSync(secretFilePath(KEY, home), { recursive: true });
    assert.equal(readStoredSecret(KEY, home), undefined);
  });
});

describe("deleteStoredSecret", () => {
  it("removes a stored value", () => {
    writeStoredSecret(KEY, "AIzaExample", home);
    deleteStoredSecret(KEY, home);
    assert.equal(readStoredSecret(KEY, home), undefined);
  });

  it("is quiet when there was nothing stored", () => {
    assert.doesNotThrow(() => deleteStoredSecret(KEY, home));
  });
});

describe("secretSource", () => {
  it("reports the store even when the shell also has a value", () => {
    writeStoredSecret(KEY, "from-store", home);
    assert.equal(secretSource(KEY, { [KEY]: "from-shell" }, home), "gui");
  });

  it("reports the environment when only the shell has one", () => {
    assert.equal(secretSource(KEY, { [KEY]: "from-shell" }, home), "env");
  });

  it("treats an empty environment value as no value", () => {
    assert.equal(secretSource(KEY, { [KEY]: "" }, home), "none");
    assert.equal(secretSource(KEY, {}, home), "none");
  });
});

describe("applyStoredSecrets", () => {
  it("overrides the shell value and remembers what it replaced", () => {
    writeStoredSecret(KEY, "from-store", home);
    const env: Record<string, string | undefined> = { [KEY]: "from-shell" };
    const result = applyStoredSecrets(env, home);
    assert.equal(env[KEY], "from-store");
    assert.deepEqual(result.applied, [KEY]);
    assert.deepEqual(result.overrode, [KEY]);
    // Clearing the stored key has to hand it back to the shell, so the old
    // value cannot be discarded here.
    assert.equal(result.replaced[KEY], "from-shell");
  });

  it("fills in a key the shell never set", () => {
    writeStoredSecret(KEY, "from-store", home);
    const env: Record<string, string | undefined> = {};
    const result = applyStoredSecrets(env, home);
    assert.equal(env[KEY], "from-store");
    assert.deepEqual(result.overrode, []);
    assert.equal(result.replaced[KEY], undefined);
  });

  it("does not report an override when both sides agree", () => {
    writeStoredSecret(KEY, "same", home);
    const result = applyStoredSecrets({ [KEY]: "same" }, home);
    assert.deepEqual(result.overrode, []);
    // Still remembered: the shell had a value, and clearing the store should
    // leave that one in place rather than unset it.
    assert.equal(result.replaced[KEY], "same");
  });

  it("leaves the environment alone when nothing is stored", () => {
    const env: Record<string, string | undefined> = { [KEY]: "from-shell" };
    const result = applyStoredSecrets(env, home);
    assert.equal(env[KEY], "from-shell");
    assert.deepEqual(result.applied, []);
  });
});
