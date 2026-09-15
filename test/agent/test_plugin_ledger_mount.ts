import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pluginLedgerMountArgs, removePluginLedgerStaging } from "../../server/agent/pluginLedgerMount.ts";
import { CONTAINER_CLAUDE_CONFIG_DIR } from "../../server/agent/pluginLedgerPaths.ts";

const PLATFORM = "linux";

function writeLedgers(configDir: string, marketplaces: unknown, plugins: unknown): void {
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  writeFileSync(join(configDir, "plugins", "known_marketplaces.json"), JSON.stringify(marketplaces));
  writeFileSync(join(configDir, "plugins", "installed_plugins.json"), JSON.stringify(plugins));
}

describe("pluginLedgerMountArgs", () => {
  const roots: string[] = [];
  const makeRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), "ledger-mount-test-"));
    roots.push(root);
    return root;
  };

  beforeEach(() => roots.splice(0, roots.length));
  afterEach(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

  it("stages nothing when the config dir has no plugin ledgers", () => {
    const root = makeRoot();
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: join(root, "cfg"), outputDir: join(root, "out") });
    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
  });

  // Every plugin lives outside the config dir: nothing to translate, so the argv
  // must come back exactly as it would have without this feature.
  it("stages nothing when no recorded path is under the config dir", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    writeLedgers(configDir, { ext: { installLocation: "/elsewhere/mp" } }, { version: 2, plugins: { "p@ext": [{ installPath: "/elsewhere/mp/plugins/p" }] } });
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out") });
    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
  });

  it("stages both ledgers with container paths and reports the staging dir", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "out");
    writeLedgers(
      configDir,
      { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } },
      { version: 2, plugins: { "p@mp": [{ installPath: join(configDir, "plugins", "cache", "mp", "p", "1.0.0") }] } },
    );
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });

    assert.equal(result.stagingDir, outputDir);
    assert.deepEqual(result.args, [
      "-v",
      `${join(outputDir, "known_marketplaces.json")}:${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/known_marketplaces.json:ro`,
      "-v",
      `${join(outputDir, "installed_plugins.json")}:${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/installed_plugins.json:ro`,
    ]);

    const staged: unknown = JSON.parse(readFileSync(join(outputDir, "installed_plugins.json"), "utf-8"));
    assert.deepEqual(staged, {
      version: 2,
      plugins: { "p@mp": [{ installPath: `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/mp/p/1.0.0` }] },
    });
  });

  // A malformed ledger is CLI-internal state we do not control; the sandbox has
  // to start regardless, just without the translation.
  it("stages nothing and does not throw on a corrupt ledger", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    writeFileSync(join(configDir, "plugins", "known_marketplaces.json"), "not json at all");
    writeFileSync(join(configDir, "plugins", "installed_plugins.json"), "{");
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out") });
    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
  });
});

describe("removePluginLedgerStaging", () => {
  // Left behind, every sandbox turn adds two files to tmpdir() for the life of
  // the machine.
  it("removes the staged directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-mount-test-"));
    const staging = join(root, "staging");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "known_marketplaces.json"), "{}");

    removePluginLedgerStaging(staging);

    assert.equal(existsSync(staging), false);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not throw when the directory is already gone", () => {
    assert.doesNotThrow(() => removePluginLedgerStaging(join(tmpdir(), "ledger-mount-test-absent-dir")));
  });
});
