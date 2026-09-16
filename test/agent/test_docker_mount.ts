import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dockerMountArgs, requiredMountArgs, toDockerSource, UnmountablePathError } from "../../server/agent/dockerMount.ts";
import type { Platform } from "../../server/agent/config.ts";

const POSIX: Platform = "linux";
const WINDOWS: Platform = "win32";
const TARGET = "/home/node/mulmoclaude";

const argsFor = (hostPath: string, platform: Platform, readOnly = false, containerPath = TARGET): string[] => {
  const result = dockerMountArgs({ hostPath, containerPath, readOnly }, platform);
  assert.equal(result.kind, "args", `expected args for ${hostPath}`);
  return result.kind === "args" ? result.args : [];
};

describe("toDockerSource", () => {
  // A backslash is an ordinary filename character on POSIX. Converting it there
  // hands Docker a path that does not exist, which it answers by creating an
  // empty directory and mounting THAT — silently.
  it("leaves a POSIX path alone, backslashes included", () => {
    assert.equal(toDockerSource("/home/u/we\\ird", POSIX), "/home/u/we\\ird");
  });

  it("converts separators on Windows", () => {
    assert.equal(toDockerSource("C:\\Users\\u\\w", WINDOWS), "C:/Users/u/w");
  });
});

describe("dockerMountArgs — flag selection", () => {
  // `-v` is the status quo. Every path that works today must keep taking it, or
  // the fix becomes a swap: `--mount` cannot carry a comma or a quote.
  it("uses -v for an ordinary path", () => {
    assert.deepEqual(argsFor("/home/u/w", POSIX), ["-v", `/home/u/w:${TARGET}`]);
  });

  it("appends :ro to a read-only -v mount", () => {
    assert.deepEqual(argsFor("/home/u/w", POSIX, true), ["-v", `/home/u/w:${TARGET}:ro`]);
  });

  it("keeps -v for a path with a comma or a quote, which --mount cannot carry", () => {
    assert.deepEqual(argsFor("/home/u/w,x", POSIX), ["-v", `/home/u/w,x:${TARGET}`]);
    assert.deepEqual(argsFor('/home/u/w"x', POSIX), ["-v", `/home/u/w"x:${TARGET}`]);
  });

  // `-v` splits its fields on `:`, so Docker rejects the whole command.
  it("falls back to --mount for a path with a colon", () => {
    assert.deepEqual(argsFor("/home/u/w:x", POSIX), ["--mount", `type=bind,source=/home/u/w:x,target=${TARGET}`]);
  });

  it("marks a read-only --mount readonly", () => {
    assert.deepEqual(argsFor("/home/u/w:x", POSIX, true), ["--mount", `type=bind,source=/home/u/w:x,target=${TARGET},readonly`]);
  });

  // The reference-dir container path embeds a basename, so the target can carry
  // a colon too — and `-v` splits on it wherever it appears.
  it("falls back to --mount when only the TARGET holds a colon", () => {
    assert.deepEqual(argsFor("/home/u/w", POSIX, true, "/mnt/readonly/a:b"), ["--mount", "type=bind,source=/home/u/w,target=/mnt/readonly/a:b,readonly"]);
  });

  it("reports a path no flag can express", () => {
    const result = dockerMountArgs({ hostPath: "/home/u/w:x,y", containerPath: TARGET, readOnly: false }, POSIX);
    assert.equal(result.kind, "inexpressible");
  });

  it("reports a colon plus a control character as inexpressible", () => {
    const result = dockerMountArgs({ hostPath: "/home/u/w:x\ny", containerPath: TARGET, readOnly: false }, POSIX);
    assert.equal(result.kind, "inexpressible");
  });
});

describe("dockerMountArgs — the Windows drive letter is not a colon to escape from", () => {
  // Every absolute Windows path opens `C:`. Treating that as "unusable with -v"
  // would push EVERY Windows mount onto --mount — the broad behaviour change
  // this fix exists to avoid.
  it("keeps -v for an ordinary Windows path", () => {
    assert.deepEqual(argsFor("C:\\Users\\u\\w", WINDOWS), ["-v", `C:/Users/u/w:${TARGET}`]);
  });

  it("keeps -v whatever the drive letter is", () => {
    assert.deepEqual(argsFor("D:\\w", WINDOWS), ["-v", `D:/w:${TARGET}`]);
  });

  // A second colon is a real one — a Windows filename cannot contain it, but an
  // alternate data stream spelling can arrive here.
  it("falls back to --mount for a Windows path with a colon past the drive", () => {
    assert.deepEqual(argsFor("C:\\Users\\u\\w:x", WINDOWS), ["--mount", `type=bind,source=C:/Users/u/w:x,target=${TARGET}`]);
  });

  // The same leading `C:` on POSIX is not a drive letter, it is a colon in a
  // relative-looking name, and must not be waved through.
  it("does not grant the drive-letter exemption on POSIX", () => {
    assert.deepEqual(argsFor("C:/Users/u/w", POSIX), ["--mount", `type=bind,source=C:/Users/u/w,target=${TARGET}`]);
  });
});

describe("requiredMountArgs", () => {
  it("returns the arguments when the path is expressible", () => {
    assert.deepEqual(requiredMountArgs({ hostPath: "/home/u/w", containerPath: TARGET, readOnly: false }, POSIX), ["-v", `/home/u/w:${TARGET}`]);
  });

  // A mount the sandbox cannot run without must name the offending path, rather
  // than leaving the user with Docker's wording about a spec they never wrote.
  it("throws naming the path when it is not expressible", () => {
    assert.throws(
      () => requiredMountArgs({ hostPath: "/home/u/w:x,y", containerPath: TARGET, readOnly: false }, POSIX),
      (error: unknown) => error instanceof UnmountablePathError && error.hostPath === "/home/u/w:x,y" && /Cannot mount .*into the sandbox/.test(error.message),
    );
  });
});
