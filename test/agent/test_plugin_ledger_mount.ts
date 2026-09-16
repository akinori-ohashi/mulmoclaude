import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pluginLedgerMountArgs, removePluginLedgerStaging, withPluginLedgerCleanup } from "../../server/agent/pluginLedgerMount.ts";
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

  // An empty directory per no-op spawn is still a directory per no-op spawn.
  it("creates no directory at all when there is nothing to stage", () => {
    const root = makeRoot();
    const outputDir = join(root, "out");
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: join(root, "cfg"), outputDir });
    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
    assert.equal(existsSync(outputDir), false);
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
      "--mount",
      `type=bind,source=${join(outputDir, "known_marketplaces.json")},target=${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/known_marketplaces.json,readonly`,
      "--mount",
      `type=bind,source=${join(outputDir, "installed_plugins.json")},target=${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/installed_plugins.json,readonly`,
    ]);

    const staged: unknown = JSON.parse(readFileSync(join(outputDir, "installed_plugins.json"), "utf-8"));
    assert.deepEqual(staged, {
      version: 2,
      plugins: { "p@mp": [{ installPath: `${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/cache/mp/p/1.0.0` }] },
    });
  });

  // A backslash is an ordinary filename character on POSIX, and `TMPDIR` can
  // contain one. Folding it to `/` would hand Docker a source path that does
  // not exist, and the sandbox would not start at all.
  it("keeps a backslash in a POSIX staging path", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "we\\ird");
    writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });
    assert.ok(result.args[1]?.includes(`source=${join(outputDir, "known_marketplaces.json")},`));
    assert.ok(result.args[1]?.includes("we\\ird"));
  });

  // `-v` splits its fields on `:`, and a POSIX `TMPDIR` may legally contain one.
  // Measured: `docker run -v "<path with colon>:..."` is rejected outright with
  // "too many colons", so the sandbox would not start at all. `--mount` takes
  // the same path.
  it("emits a staging path containing a colon rather than breaking the argv", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "stag:ing");
    writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });
    assert.equal(result.args[0], "--mount");
    assert.ok(result.args[1]?.includes("stag:ing"));
    assert.equal(result.stagingDir, outputDir);
  });

  // Docker parses `--mount` as one CSV record: `,` ends the field, a bare `"`
  // puts its reader into a quoted-field state it rejects, and a newline ends the
  // record. All three reject the whole `docker run`, so such a path must cost
  // the plugins rather than the sandbox.
  ["stag,ing", 'stag"ing', "stag\ning"].forEach((name) => {
    it(`stages nothing when the staging path holds ${JSON.stringify(name)}`, () => {
      const root = makeRoot();
      const configDir = join(root, "cfg");
      const outputDir = join(root, name);
      writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
      const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });
      assert.deepEqual(result.args, []);
      assert.equal(result.stagingDir, null);
      assert.equal(existsSync(outputDir), false);
    });
  });

  // Opening a FIFO for read waits for a writer FOREVER, and this open is
  // synchronous on the spawn path — so a pipe where the ledger should be would
  // freeze the turn rather than fail it. The test would hang, not fail, if the
  // descriptor were opened blocking.
  it("does not hang, and stages nothing, when a ledger is a FIFO", { skip: process.platform === "win32" }, () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    execFileSync("mkfifo", [join(configDir, "plugins", "known_marketplaces.json")]);
    writeFileSync(join(configDir, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: {} }));

    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out") });

    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
  });

  // Same rule, reachable on every platform: whatever is at the path, only a
  // regular file is read from.
  it("stages nothing when a ledger path is a directory", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    mkdirSync(join(configDir, "plugins", "known_marketplaces.json"), { recursive: true });
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out") });
    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
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

describe("withPluginLedgerCleanup", () => {
  // `spawn` throws synchronously for a malformed argument, which is before any
  // child exists to carry the `close` listener that normally cleans up.
  it("removes the staging when the wrapped call throws, and rethrows", () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-mount-test-"));
    const staging = join(root, "staging");
    mkdirSync(staging, { recursive: true });
    const boom = new Error("spawn EINVAL");

    assert.throws(
      () =>
        withPluginLedgerCleanup(staging, () => {
          throw boom;
        }),
      /spawn EINVAL/,
    );
    assert.equal(existsSync(staging), false);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps the staging and returns the value when the wrapped call succeeds", () => {
    const root = mkdtempSync(join(tmpdir(), "ledger-mount-test-"));
    const staging = join(root, "staging");
    mkdirSync(staging, { recursive: true });

    assert.equal(
      withPluginLedgerCleanup(staging, () => "child"),
      "child",
    );
    assert.equal(existsSync(staging), true);
    rmSync(root, { recursive: true, force: true });
  });

  it("is a no-op wrapper when nothing was staged", () => {
    assert.throws(() =>
      withPluginLedgerCleanup(null, () => {
        throw new Error("boom");
      }),
    );
  });
});
