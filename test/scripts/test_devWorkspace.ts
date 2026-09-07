// Both halves of the dev client have to look in the SAME workspace (#2981).
//
// `vite.config.ts` takes the session token out of it and the readiness wait
// takes the published port, so a disagreement means the config finds neither:
// an empty auth token and a proxy pointed back at the port that was merely
// requested. That is exactly what happened — the config matched
// `^MULMOCLAUDE_WORKSPACE_PATH=(.+)$` with its own regex while the wait used the
// launcher's `dotenv.parse`, and the two differ on every quoted or commented
// value.
//
// So the values here come from `parseEnvFile` — the real parser — rather than
// from a literal object, which is what makes this a test of the AGREEMENT and
// not of a second opinion written in the test file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { resolveDevWorkspacePath } from "../../scripts/lib/devWorkspace.js";
import { parseEnvFile } from "../../server/utils/launch-env.mjs";

/** Parse `body` as a real `.env`, the way both callers do. */
function envValues(body: string): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), "dev-workspace-test-"));
  const file = path.join(dir, ".env");
  try {
    writeFileSync(file, body);
    return parseEnvFile(file).parsed;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("resolveDevWorkspacePath", () => {
  it("takes the shell value when it is set", () => {
    assert.equal(resolveDevWorkspacePath({ processEnv: { MULMOCLAUDE_WORKSPACE_PATH: "/from/shell" } }), "/from/shell");
  });

  it("falls back to `.env` when the shell has none", () => {
    assert.equal(resolveDevWorkspacePath({ envFileValues: envValues("MULMOCLAUDE_WORKSPACE_PATH=/from/env\n") }), "/from/env");
  });

  it("falls back to the default when neither is set", () => {
    assert.equal(resolveDevWorkspacePath(), path.join(homedir(), "mulmoclaude"));
  });

  it("treats an empty value as unset, at both sources", () => {
    assert.equal(resolveDevWorkspacePath({ processEnv: { MULMOCLAUDE_WORKSPACE_PATH: "" } }), path.join(homedir(), "mulmoclaude"));
    assert.equal(resolveDevWorkspacePath({ envFileValues: envValues("MULMOCLAUDE_WORKSPACE_PATH=\n") }), path.join(homedir(), "mulmoclaude"));
  });

  // The shapes the hand-rolled regex got wrong. Each of these used to send the
  // config and the wait to different directories.
  [
    { name: "double-quoted", body: 'MULMOCLAUDE_WORKSPACE_PATH="/tmp/ws"\n', expected: "/tmp/ws" },
    { name: "single-quoted", body: "MULMOCLAUDE_WORKSPACE_PATH='/tmp/ws'\n", expected: "/tmp/ws" },
    { name: "quoted with a space", body: 'MULMOCLAUDE_WORKSPACE_PATH="/tmp/my ws"\n', expected: "/tmp/my ws" },
    { name: "trailing inline comment", body: "MULMOCLAUDE_WORKSPACE_PATH=/tmp/ws # scratch\n", expected: "/tmp/ws" },
    { name: "quoted with a trailing comment", body: 'MULMOCLAUDE_WORKSPACE_PATH="/tmp/ws" # scratch\n', expected: "/tmp/ws" },
    { name: "surrounded by other keys", body: "PORT=3100\nMULMOCLAUDE_WORKSPACE_PATH=/tmp/ws\nOTHER=1\n", expected: "/tmp/ws" },
  ].forEach(({ name, body, expected }) => {
    it(`reads a ${name} value the way the launcher does`, () => {
      assert.equal(resolveDevWorkspacePath({ envFileValues: envValues(body) }), expected);
    });
  });

  it("never returns a value carrying quotes or a comment", () => {
    const resolved = resolveDevWorkspacePath({ envFileValues: envValues('MULMOCLAUDE_WORKSPACE_PATH="/tmp/ws" # scratch\n') });
    assert.doesNotMatch(resolved, /["'#]/, "a path with quoting left in points at a directory that does not exist");
  });
});
