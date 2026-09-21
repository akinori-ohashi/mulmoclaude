// The blocklist that decides which host paths may be bind-mounted into the
// sandbox. It was private to `reference-dirs.ts` until #3198 gave it a second
// caller (plugin trees registered from a local path), and a security rule with
// two copies is one that drifts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveMountPath } from "../../server/utils/sensitiveMountPaths.ts";

const HOME = "/Users/someone";
const POSIX = { home: HOME, platform: "linux" as const };

describe("isSensitiveMountPath", () => {
  it("allows an ordinary directory", () => {
    assert.equal(isSensitiveMountPath(`${HOME}/dev/project`, POSIX), false);
  });

  it("refuses the filesystem root", () => {
    assert.equal(isSensitiveMountPath("/", POSIX), true);
  });

  // $HOME transitively carries .ssh and everything else on the list.
  it("refuses $HOME itself", () => {
    assert.equal(isSensitiveMountPath(HOME, POSIX), true);
  });

  [".ssh", ".aws", ".gnupg", ".config/gh", ".kube", ".docker"].forEach((blocked) => {
    it(`refuses ~/${blocked} and anything under it`, () => {
      assert.equal(isSensitiveMountPath(`${HOME}/${blocked}`, POSIX), true);
      assert.equal(isSensitiveMountPath(`${HOME}/${blocked}/nested/deeper`, POSIX), true);
    });
  });

  ["/etc", "/root", "/var", "/proc", "/sys", "/boot", "/private/etc", "/private/var", "/System", "/Library"].forEach((blocked) => {
    it(`refuses ${blocked} and anything under it`, () => {
      assert.equal(isSensitiveMountPath(blocked, POSIX), true);
      assert.equal(isSensitiveMountPath(`${blocked}/nested`, POSIX), true);
    });
  });

  // The `+ path.sep` guard: a sibling whose name merely starts with a blocked
  // one is not inside it.
  it("does not treat a name-prefixed sibling as being inside a blocked directory", () => {
    assert.equal(isSensitiveMountPath("/etc-backup", POSIX), false);
    assert.equal(isSensitiveMountPath(`${HOME}/.ssh-notes`, POSIX), false);
  });

  // macOS `os.tmpdir()` resolves under `/var`, so this is the rule that stops a
  // test building a fixture in a temp directory — the reason the seam below
  // exists at all (#3196).
  it("refuses a macOS-shaped temp directory", () => {
    assert.equal(isSensitiveMountPath("/var/folders/ab/cd/T/thing", POSIX), true);
  });

  it("honours an injected system list, so a fixture can live in a temp directory", () => {
    assert.equal(isSensitiveMountPath("/var/folders/ab/cd/T/thing", { ...POSIX, systemBlocked: [] }), false);
    // The home rules still apply — the seam replaces the SYSTEM list only.
    assert.equal(isSensitiveMountPath(`${HOME}/.ssh`, { ...POSIX, systemBlocked: [] }), true);
  });

  describe("windows", () => {
    const WINDOWS_HOME = "C:\\Users\\Someone";
    const WINDOWS = { home: WINDOWS_HOME, platform: "win32" as const };

    // Windows filesystems are case-insensitive, so the lowercase spelling names
    // the same directory and must not walk past the blocklist.
    it("compares case-insensitively", () => {
      assert.equal(isSensitiveMountPath("c:\\users\\someone\\.ssh", WINDOWS), true);
      assert.equal(isSensitiveMountPath("C:\\Users\\Someone\\.SSH", WINDOWS), true);
    });

    it("still refuses $HOME itself", () => {
      assert.equal(isSensitiveMountPath("c:\\users\\someone", WINDOWS), true);
    });

    it("allows an ordinary Windows directory", () => {
      assert.equal(isSensitiveMountPath("C:\\Users\\Someone\\dev\\project", WINDOWS), false);
    });
  });
});
