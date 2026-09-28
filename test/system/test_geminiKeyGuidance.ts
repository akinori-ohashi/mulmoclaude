// Tests for `server/system/geminiKeyGuidance.ts` — where the app tells a
// user a missing GEMINI_API_KEY belongs.
//
// The old text named "the directory you launch MulmoClaude from, or export
// it before starting" and both halves were wrong from an icon (#2626), so
// what is pinned here is that neither claim can come back on that route:
// the path is named, and the export is not offered.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { geminiKeyMissingMessage, launchRouteFacts, GEMINI_KEY_MISSING_HEADLINE } from "../../server/system/geminiKeyGuidance.js";

describe("launchRouteFacts", () => {
  it("uses the path the launcher handed over", () => {
    const facts = launchRouteFacts({ launchEnvPath: "/Users/example/.env", launchedFromIcon: true, cwd: "/somewhere/else" });
    assert.equal(facts.envFilePath, "/Users/example/.env");
  });

  it("falls back to the server's own cwd when nothing launched us", () => {
    // `yarn dev` / `tsx server/index.ts`: the server's own `.env` load
    // reads `<cwd>/.env`, so that is the file to name.
    const facts = launchRouteFacts({ launchedFromIcon: false, cwd: "/repo" });
    assert.equal(facts.envFilePath, path.join("/repo", ".env"));
  });

  it("ignores a handed path that is relative or carries control characters", () => {
    // The value arrives through `process.env`, which anything on the box
    // can set, and it is typeset into a log line and the UI.
    const relative = launchRouteFacts({ launchEnvPath: "not/absolute/.env", launchedFromIcon: false, cwd: "/repo" });
    assert.equal(relative.envFilePath, path.join("/repo", ".env"));
    const injected = launchRouteFacts({ launchEnvPath: "/tmp/.env\nWARN something else entirely", launchedFromIcon: false, cwd: "/repo" });
    assert.equal(injected.envFilePath, path.join("/repo", ".env"));
    // C1 as well as C0: U+009B is CSI, so a terminal reading the log line can
    // act on it, and a `<= 0x1f` cutoff would have let it through.
    const csi = launchRouteFacts({ launchEnvPath: "/tmp/\u009b31m.env", launchedFromIcon: false, cwd: "/repo" });
    assert.equal(csi.envFilePath, path.join("/repo", ".env"));
  });

  it("ignores an empty or whitespace-only handed path", () => {
    assert.equal(launchRouteFacts({ launchEnvPath: "", launchedFromIcon: false, cwd: "/repo" }).envFilePath, path.join("/repo", ".env"));
    assert.equal(launchRouteFacts({ launchEnvPath: "   ", launchedFromIcon: false, cwd: "/repo" }).envFilePath, path.join("/repo", ".env"));
  });

  it("reports the shell as unreachable exactly when the icon launched us", () => {
    assert.equal(launchRouteFacts({ launchedFromIcon: true, cwd: "/" }).shellExportReaches, false);
    assert.equal(launchRouteFacts({ launchedFromIcon: false, cwd: "/repo" }).shellExportReaches, true);
  });
});

describe("geminiKeyMissingMessage", () => {
  it("names the file on both routes, never a directory the user has to work out", () => {
    for (const shellExportReaches of [true, false]) {
      const message = geminiKeyMissingMessage({ envFilePath: "/Users/example/.env", shellExportReaches });
      assert.ok(message.startsWith(GEMINI_KEY_MISSING_HEADLINE), message);
      assert.ok(message.includes("/Users/example/.env"), message);
    }
  });

  it("offers the shell only where a shell can reach", () => {
    const terminal = geminiKeyMissingMessage({ envFilePath: "/repo/.env", shellExportReaches: true });
    assert.match(terminal, /export/);

    // The icon launcher takes PATH from the login shell and nothing else,
    // so telling this user to export is telling them to do nothing.
    const icon = geminiKeyMissingMessage({ envFilePath: "/Users/example/.env", shellExportReaches: false });
    assert.doesNotMatch(icon, /or export/);
    assert.match(icon, /never reaches it/);
  });

  it("does not claim a launch directory exists", () => {
    const icon = geminiKeyMissingMessage({ envFilePath: "/Users/example/.env", shellExportReaches: false });
    assert.doesNotMatch(icon, /the directory you launch/);
  });
});
