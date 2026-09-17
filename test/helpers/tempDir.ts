import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A temp directory that removes itself when the test process exits.
//
// `tsx --test` runs one process per test file, so a single exit hook collects
// everything the file made — module scope, before(), or inside a test — without
// each call site having to remember a teardown. Tests that skipped that teardown
// leaked ~208 directories per full-suite run into $TMPDIR (#2789).
//
// Exit hooks can only do synchronous work, which is why removal is rmSync.
const created: string[] = [];
let hookInstalled = false;

const installExitHook = () => {
  if (hookInstalled) return;
  hookInstalled = true;
  process.once("exit", () => created.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
};

export const makeTempDir = (prefix: string): string => {
  installExitHook();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

// On macOS `tmpdir()` is `/var/folders/...`, and `/var` is on the sandbox's
// sensitive-path blocklist — so a fixture there is refused for a reason the test
// is usually not about. The only way out used to be writing under `$HOME`, and a
// sandboxed reviewer gets EPERM on that, which makes the suite unrunnable for
// the second pair of eyes (#3196).
//
// `/tmp` resolves to `/private/tmp`, which is NOT on the list. Elsewhere
// `tmpdir()` is already fine: Linux gives `/tmp`, and Windows gives a directory
// under the user profile, where only the profile root itself is blocked.
const UNBLOCKED_TMP_BASE = process.platform === "darwin" ? "/tmp" : tmpdir();

/** A temp directory the REAL sensitive-path blocklist accepts.
 *
 *  Use this — not `makeTempDir` — whenever the code under test resolves the
 *  fixture and asks `isSensitiveMountPath` about it with no injected seam. */
export const makeUnblockedTempDir = (prefix: string): string => {
  installExitHook();
  const dir = mkdtempSync(join(UNBLOCKED_TMP_BASE, prefix));
  created.push(dir);
  return dir;
};
