import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { externalPluginTrees, pluginLedgerMountArgs, removePluginLedgerStaging, withPluginLedgerCleanup } from "../../server/agent/pluginLedgerMount.ts";
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

  // This case used to assert `args: []` — the old behaviour, where a marketplace
  // outside the config dir simply did not load in the sandbox. #3198 mounts the
  // tree instead, so the expectation inverts: the limitation was the bug.
  it("mounts a tree outside the config dir and points the ledger at it", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const external = join(root, "elsewhere", "mp");
    mkdirSync(external, { recursive: true });
    writeLedgers(configDir, { ext: { installLocation: external } }, { version: 2, plugins: { "p@ext": [{ installPath: join(external, "plugins", "p") }] } });

    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out"), home: root, systemBlocked: [] });

    // The RESOLVED spelling is what gets bound, which is the point: a symlink
    // must not be able to redirect the bind after the blocklist has passed it.
    // On macOS this is visible even with no symlink of our own — `/var` is one,
    // so a tmpdir path resolves under `/private/var`.
    const treeMount = result.args.find((arg) => arg.startsWith(`${realpathSync.native(external)}:`));
    assert.ok(treeMount, `expected the external tree to be mounted, got ${JSON.stringify(result.args)}`);
    const [, containerRoot] = treeMount.split(":");
    assert.match(containerRoot ?? "", /^\/mnt\/plugin-src\//);
    assert.ok(treeMount.endsWith(":ro"), "a plugin tree is mounted read-only");

    // And the staged ledger points INTO that mount, not at the host path.
    const staged: unknown = JSON.parse(readFileSync(join(root, "out", "installed_plugins.json"), "utf-8"));
    assert.deepEqual(staged, { version: 2, plugins: { "p@ext": [{ installPath: `${containerRoot}/plugins/p` }] } });
  });

  // The tree mount is a plain directory; the ledger copies overlay files inside
  // the config-dir mount, and an overlay has to follow what it sits on.
  it("orders the tree mount before the ledger overlays", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const external = join(root, "elsewhere", "mp");
    mkdirSync(external, { recursive: true });
    writeLedgers(configDir, { ext: { installLocation: external } }, { version: 2, plugins: {} });

    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out"), home: root, systemBlocked: [] });
    const treeIndex = result.args.findIndex((arg) => arg.startsWith(`${realpathSync.native(external)}:`));
    const overlayIndex = result.args.findIndex((arg) => arg.includes("known_marketplaces.json:"));
    assert.ok(treeIndex >= 0 && overlayIndex >= 0);
    assert.ok(treeIndex < overlayIndex, "the tree must be mounted before the overlay that references it");
  });

  // A sensitive path is refused whatever the ledger says, so the ledger keeps
  // its host path and nothing new is mounted.
  it("stages nothing when the only external tree is one the sandbox must never see", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const secret = join(root, ".ssh");
    mkdirSync(secret, { recursive: true });
    writeLedgers(configDir, { ext: { installLocation: secret } }, { version: 2, plugins: {} });

    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out"), home: root, systemBlocked: [] });
    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
  });

  // Raised by Codex in review and kept DELIBERATELY: resolving the alias means
  // the bind source is the realpath, so a tree whose ALIAS is Docker-expressible
  // but whose realpath is not now costs the mount. The alternative — staging a
  // safe-named symlink to bind through — buys a rarity (a realpath holding both
  // a colon and a comma) at the price of a symlink farm to create and clean up.
  // Skipping matches what the rest of this module already does when a path
  // cannot be expressed, and costs the plugins rather than the container.
  it("stages nothing when the resolved path cannot be expressed, even though the alias could", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const alias = join(root, "elsewhere", "clean-name");
    mkdirSync(alias, { recursive: true });
    writeLedgers(configDir, { ext: { installLocation: alias } }, { version: 2, plugins: {} });

    const result = pluginLedgerMountArgs({
      platform: PLATFORM,
      hostConfigDir: configDir,
      outputDir: join(root, "out"),
      home: root,
      systemBlocked: [],
      // `:` rules out `-v`, `,` rules out `--mount`. Neither flag carries it.
      resolveRealPath: (hostPath: string) => (hostPath === alias ? `${root}/real/a:b,c` : hostPath),
    });

    assert.deepEqual(result.args, [], "a ledger pointing into a mount that does not exist is worse than no translation");
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
    // `-v` for an ordinary path: the shared mount helper only reaches for
    // `--mount` when a colon rules `-v` out (#3191).
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

  // A backslash is an ordinary filename character on POSIX, and `TMPDIR` can
  // contain one. Folding it to `/` would hand Docker a source path that does
  // not exist, and the sandbox would not start at all.
  it("keeps a backslash in a POSIX staging path", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "we\\ird");
    writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });
    assert.equal(result.args[0], "-v");
    assert.ok(result.args[1]?.startsWith(`${join(outputDir, "known_marketplaces.json")}:`));
    assert.ok(result.args[1]?.includes("we\\ird"));
  });

  // `-v` splits its fields on `:`, and a POSIX `TMPDIR` may legally contain one.
  // Measured: `docker run -v "<path with colon>:..."` is rejected outright with
  // "too many colons", so the sandbox would not start at all. `--mount` takes
  // the same path.
  it("falls back to --mount for a staging path containing a colon", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "stag:ing");
    writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });
    assert.equal(result.args[0], "--mount");
    assert.ok(result.args[1]?.includes("stag:ing"));
    assert.equal(result.stagingDir, outputDir);
  });

  // These three used to be skipped, because #3188 emitted `--mount`
  // unconditionally and `--mount` cannot carry any of them. `-v` carries all
  // three — its only forbidden character is `:` — so routing through the shared
  // helper turns three skipped cases into three working ones (#3191).
  ["stag,ing", 'stag"ing', "stag\ning"].forEach((name) => {
    it(`stages through -v when the staging path holds ${JSON.stringify(name)}`, () => {
      const root = makeRoot();
      const configDir = join(root, "cfg");
      const outputDir = join(root, name);
      writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
      const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });
      assert.equal(result.args[0], "-v");
      assert.ok(result.args[1]?.includes(name));
      assert.equal(result.stagingDir, outputDir);
    });
  });

  // A colon AND a character `--mount` cannot carry: no flag can express it, so
  // the plugins are skipped and the sandbox still starts.
  it("stages nothing when no docker flag can express the staging path", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "stag:i,ng");
    writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
    const result = pluginLedgerMountArgs({ platform: PLATFORM, hostConfigDir: configDir, outputDir });
    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
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

// A marketplace registered with `claude plugin marketplace add <local path>` is
// the plugin author's ordinary workflow, and its tree is outside the config dir
// — so nothing carries it into the container and the plugin is inert in the
// sandbox while working on the host (#3198). Mounting the tree and pointing the
// ledger at the mount is what fixes it.
describe("externalPluginTrees — what has to be mounted beyond the config dir", () => {
  const HOME = "/Users/fake";
  const CONFIG = `${HOME}/.claude`;

  // Every candidate here is an imaginary path, so the real `realpathSync` would
  // reject the lot. `links` names the ones that are symlinks; everything else
  // resolves to itself, which is what an ordinary directory does.
  const resolver =
    (links: Record<string, string> = {}, missing: readonly string[] = []) =>
    (hostPath: string): string | null =>
      missing.includes(hostPath) ? null : (links[hostPath] ?? hostPath);

  const treesOf = (candidates: string[], links?: Record<string, string>, missing?: readonly string[]) =>
    externalPluginTrees(candidates, CONFIG, "/", PLATFORM, { home: HOME, resolveRealPath: resolver(links, missing) });
  const roots = (candidates: string[], links?: Record<string, string>, missing?: readonly string[]): string[] =>
    treesOf(candidates, links, missing).map((tree) => tree.mountSource);

  it("ignores a path already carried by the config-dir mount", () => {
    assert.deepEqual(roots([`${CONFIG}/plugins/marketplaces/mp`]), []);
  });

  it("returns a tree outside the config dir", () => {
    assert.deepEqual(roots([`${HOME}/dev/my-marketplace`]), [`${HOME}/dev/my-marketplace`]);
  });

  // Two overlapping mounts is a way for the inner one to shadow the outer's
  // files; the parent already carries the child.
  it("drops a path whose parent is already being mounted", () => {
    assert.deepEqual(roots([`${HOME}/dev/mp`, `${HOME}/dev/mp/plugins/one`]), [`${HOME}/dev/mp`]);
  });

  it("deduplicates the same tree named by both ledgers", () => {
    assert.deepEqual(roots([`${HOME}/dev/mp`, `${HOME}/dev/mp`]), [`${HOME}/dev/mp`]);
  });

  it("refuses a relative path or one with traversal segments", () => {
    assert.deepEqual(roots(["dev/mp", `${HOME}/dev/../dev/mp`]), []);
  });

  it("refuses a tree that is not on the host at all", () => {
    assert.deepEqual(roots([`${HOME}/dev/deleted`], {}, [`${HOME}/dev/deleted`]), []);
  });

  // The blocklist is the one reference directories already use. These are the
  // paths a bind mount must never expose, whatever the ledger says.
  [
    [`${HOME}/.ssh`, "private keys"],
    [`${HOME}/.aws/credentials-dir`, "cloud credentials"],
    [HOME, "$HOME itself, which transitively carries all of them"],
    ["/etc/somewhere", "a system directory"],
    ["/", "the filesystem root"],
  ].forEach(([candidate, why]) => {
    it(`refuses ${why}`, () => {
      assert.deepEqual(roots([String(candidate)]), []);
    });
  });

  // The gate has to run on what Docker BINDS, not on what the ledger says.
  // Measured against the daemon: `-v <symlink>:/x:ro` exposes the symlink's
  // TARGET in the container, so a lexical check alone hands `.ssh` to the
  // sandbox under any harmless name.
  describe("a symlink cannot smuggle a blocked tree past the blocklist", () => {
    [
      [`${HOME}/.ssh`, "private keys"],
      ["/etc", "a system directory"],
      [HOME, "$HOME itself"],
    ].forEach(([target, why]) => {
      it(`refuses an innocent-looking name resolving to ${why}`, () => {
        assert.deepEqual(roots([`${HOME}/dev/innocent`], { [`${HOME}/dev/innocent`]: String(target) }), []);
      });
    });

    it("mounts the RESOLVED path, so the bind cannot be redirected after the check", () => {
      const trees = treesOf([`${HOME}/dev/link`], { [`${HOME}/dev/link`]: `${HOME}/real/tree` });
      assert.equal(trees[0]?.mountSource, `${HOME}/real/tree`);
    });

    // The ledger records whichever spelling the CLI saw, so both have to
    // translate — they are one directory.
    it("keeps the ledger's own spelling as an alias of the resolved tree", () => {
      const trees = treesOf([`${HOME}/dev/link`], { [`${HOME}/dev/link`]: `${HOME}/real/tree` });
      assert.deepEqual(trees[0]?.aliases, [`${HOME}/dev/link`]);
    });

    it("gives two symlinks to one tree a single mount with both aliases", () => {
      const links = { [`${HOME}/dev/a`]: `${HOME}/real/tree`, [`${HOME}/dev/b`]: `${HOME}/real/tree` };
      const trees = treesOf([`${HOME}/dev/a`, `${HOME}/dev/b`], links);
      assert.equal(trees.length, 1, "one directory is one mount");
      assert.deepEqual(trees[0]?.aliases, [`${HOME}/dev/a`, `${HOME}/dev/b`]);
    });
  });

  // Windows filesystems are case-insensitive, so these name ONE directory.
  // Containment is case-insensitive too, which made each spelling read as
  // "inside" the other — and the nesting filter dropped BOTH, mounting nothing.
  it("keeps one representative when two Windows spellings differ only in case", () => {
    const winHome = "C:\\Users\\fake";
    const trees = externalPluginTrees(["C:\\Dev\\MP", "c:\\dev\\mp"], `${winHome}\\.claude`, "\\", "win32", {
      home: winHome,
      resolveRealPath: (hostPath: string) => hostPath,
    });
    assert.equal(trees.length, 1, "two spellings of one tree must still be mounted");
    assert.deepEqual(trees[0]?.aliases, ["C:\\Dev\\MP", "c:\\dev\\mp"], "both spellings must translate");
  });

  it("gives each tree a stable, collision-free container root", () => {
    const first = treesOf([`${HOME}/dev/a`, `${HOME}/other/a`]);
    const again = treesOf([`${HOME}/dev/a`]);

    assert.equal(new Set(first.map((tree) => tree.containerRoot)).size, 2, "same basename, different tree — must not collide");
    assert.equal(first[0]?.containerRoot, again[0]?.containerRoot, "the same host path must map to the same place every turn");
    first.forEach((tree) => assert.match(tree.containerRoot, /^\/mnt\/plugin-src\/[A-Za-z0-9._-]+$/));
  });

  // The readable half is decoration; the hash carries uniqueness. Letting the
  // host path's punctuation through would put it in a mount TARGET.
  it("keeps the host path's punctuation out of the container root", () => {
    const trees = treesOf([`${HOME}/dev/we:ird,name`]);
    assert.match(trees[0]?.containerRoot ?? "", /^\/mnt\/plugin-src\/we_ird_name-[0-9a-f]{8}$/);
  });
});
