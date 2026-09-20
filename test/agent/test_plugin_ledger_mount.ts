import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { externalPluginMounts, pluginLedgerMountArgs, removePluginLedgerStaging, withPluginLedgerCleanup } from "../../server/agent/pluginLedgerMount.ts";
import { CONTAINER_CLAUDE_CONFIG_DIR } from "../../server/agent/pluginLedgerPaths.ts";
import { toDockerSource } from "../../server/agent/dockerMount.ts";

// The fixtures below are real directories, so the host spells them. The module
// picks its path separator from `platform` and only rewrites `\` for `win32`,
// so a fixed "linux" leaves a Windows ledger unmatched by its own config dir and
// nothing is ever staged (#3218). Production always passes `process.platform`.
const HOST_PLATFORM = process.platform;

/** The `-v` source the module builds for a host path, on this host. */
const mountSource = (hostPath: string): string => toDockerSource(hostPath, HOST_PLATFORM);

// A directory NAME holding a colon, a comma, a quote, a newline or a backslash is
// ordinary on POSIX and impossible on NTFS, so these fixtures cannot exist on
// Windows — the rule they pin is a POSIX-filename rule.
const posixFilenamesOnly = { skip: process.platform === "win32" };

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
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: join(root, "cfg"), outputDir: join(root, "out") });
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

    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out"), home: root, systemBlocked: [] });

    // The RESOLVED spelling is what gets bound, which is the point: a symlink
    // must not be able to redirect the bind after the blocklist has passed it.
    // On macOS this is visible even with no symlink of our own — `/var` is one,
    // so a tmpdir path resolves under `/private/var`.
    const source = mountSource(realpathSync.native(external));
    const treeMount = result.args.find((arg) => arg.startsWith(`${source}:`));
    assert.ok(treeMount, `expected the external tree to be mounted, got ${JSON.stringify(result.args)}`);
    // Sliced off the source rather than split on ":", which a Windows drive letter carries.
    const containerRoot = treeMount.slice(source.length + 1).replace(/:ro$/, "");
    assert.match(containerRoot, /^\/mnt\/plugin-src\//);
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

    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out"), home: root, systemBlocked: [] });
    const treeIndex = result.args.findIndex((arg) => arg.startsWith(`${mountSource(realpathSync.native(external))}:`));
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

    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out"), home: root, systemBlocked: [] });
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
      platform: HOST_PLATFORM,
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
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: join(root, "cfg"), outputDir });
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
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir });

    assert.equal(result.stagingDir, outputDir);
    // `-v` for an ordinary path: the shared mount helper only reaches for
    // `--mount` when a colon rules `-v` out (#3191).
    assert.deepEqual(result.args, [
      "-v",
      `${mountSource(join(outputDir, "known_marketplaces.json"))}:${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/known_marketplaces.json:ro`,
      "-v",
      `${mountSource(join(outputDir, "installed_plugins.json"))}:${CONTAINER_CLAUDE_CONFIG_DIR}/plugins/installed_plugins.json:ro`,
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
  it("keeps a backslash in a POSIX staging path", posixFilenamesOnly, () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "we\\ird");
    writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir });
    assert.equal(result.args[0], "-v");
    assert.ok(result.args[1]?.startsWith(`${mountSource(join(outputDir, "known_marketplaces.json"))}:`));
    assert.ok(result.args[1]?.includes("we\\ird"));
  });

  // `-v` splits its fields on `:`, and a POSIX `TMPDIR` may legally contain one.
  // Measured: `docker run -v "<path with colon>:..."` is rejected outright with
  // "too many colons", so the sandbox would not start at all. `--mount` takes
  // the same path.
  it("falls back to --mount for a staging path containing a colon", posixFilenamesOnly, () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    const outputDir = join(root, "stag:ing");
    writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir });
    assert.equal(result.args[0], "--mount");
    assert.ok(result.args[1]?.includes("stag:ing"));
    assert.equal(result.stagingDir, outputDir);
  });

  // These three used to be skipped, because #3188 emitted `--mount`
  // unconditionally and `--mount` cannot carry any of them. `-v` carries all
  // three — its only forbidden character is `:` — so routing through the shared
  // helper turns three skipped cases into three working ones (#3191).
  ["stag,ing", 'stag"ing', "stag\ning"].forEach((name) => {
    it(`stages through -v when the staging path holds ${JSON.stringify(name)}`, posixFilenamesOnly, () => {
      const root = makeRoot();
      const configDir = join(root, "cfg");
      const outputDir = join(root, name);
      writeLedgers(configDir, { mp: { installLocation: join(configDir, "plugins", "marketplaces", "mp") } }, { version: 2, plugins: {} });
      const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir });
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
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir });
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

    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out") });

    assert.deepEqual(result.args, []);
    assert.equal(result.stagingDir, null);
  });

  // Same rule, reachable on every platform: whatever is at the path, only a
  // regular file is read from.
  it("stages nothing when a ledger path is a directory", () => {
    const root = makeRoot();
    const configDir = join(root, "cfg");
    mkdirSync(join(configDir, "plugins", "known_marketplaces.json"), { recursive: true });
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out") });
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
    const result = pluginLedgerMountArgs({ platform: HOST_PLATFORM, hostConfigDir: configDir, outputDir: join(root, "out") });
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
describe("externalPluginMounts — what has to be mounted beyond the config dir", () => {
  // Unlike the describes above, every path here is an imaginary POSIX one and the
  // resolver is injected — nothing touches the filesystem — so this block states
  // its own platform and stays a POSIX case on every runner.
  const POSIX_PLATFORM = "linux";
  const HOME = "/Users/fake";
  const CONFIG = `${HOME}/.claude`;
  const CONTAINER_CONFIG = "/home/node/.claude";

  // Every candidate here is an imaginary path, so the real `realpathSync` would
  // reject the lot. `links` names the ones that are symlinks; everything else
  // resolves to itself, which is what an ordinary directory does.
  const resolver =
    (links: Record<string, string> = {}, missing: readonly string[] = []) =>
    (hostPath: string): string | null =>
      missing.includes(hostPath) ? null : (links[hostPath] ?? hostPath);

  const plan = (candidates: string[], links?: Record<string, string>, missing?: readonly string[]) =>
    externalPluginMounts(candidates, CONFIG, "/", POSIX_PLATFORM, { home: HOME, resolveRealPath: resolver(links, missing) });
  const roots = (candidates: string[], links?: Record<string, string>, missing?: readonly string[]): string[] =>
    plan(candidates, links, missing).mounts.map((mount) => mount.hostPath);
  const mappingFor = (result: ReturnType<typeof plan>, alias: string): string | undefined =>
    result.mappings.find((mapping) => mapping.hostRoot === alias)?.containerRoot;

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
      assert.deepEqual(roots([`${HOME}/dev/link`], { [`${HOME}/dev/link`]: `${HOME}/real/tree` }), [`${HOME}/real/tree`]);
    });

    // The ledger records whichever spelling the CLI saw, so both have to
    // translate — they are one directory.
    it("keeps the ledger's own spelling as a mapping onto the resolved tree", () => {
      const result = plan([`${HOME}/dev/link`], { [`${HOME}/dev/link`]: `${HOME}/real/tree` });
      assert.equal(mappingFor(result, `${HOME}/dev/link`), result.mounts[0]?.containerPath);
    });

    it("gives two symlinks to one tree a single mount and a mapping each", () => {
      const links = { [`${HOME}/dev/a`]: `${HOME}/real/tree`, [`${HOME}/dev/b`]: `${HOME}/real/tree` };
      const result = plan([`${HOME}/dev/a`, `${HOME}/dev/b`], links);
      assert.equal(result.mounts.length, 1, "one directory is one mount");
      assert.equal(mappingFor(result, `${HOME}/dev/a`), result.mounts[0]?.containerPath);
      assert.equal(mappingFor(result, `${HOME}/dev/b`), result.mounts[0]?.containerPath);
    });
  });

  // A spelling does not have to sit AT a mount root. Dropping a nested tree
  // without carrying its spelling across left a ledger value pointing at a host
  // path, inside a container that does carry the bytes.
  it("maps a spelling nested BELOW a mounted root to its offset inside that mount", () => {
    const result = plan([`${HOME}/dev/mp`, `${HOME}/linked-plugin`], {
      [`${HOME}/dev/mp`]: `${HOME}/real/mp`,
      [`${HOME}/linked-plugin`]: `${HOME}/real/mp/plugins/p`,
    });

    assert.deepEqual(
      result.mounts.map((mount) => mount.hostPath),
      [`${HOME}/real/mp`],
      "the parent alone is mounted",
    );
    assert.equal(mappingFor(result, `${HOME}/linked-plugin`), `${result.mounts[0]?.containerPath}/plugins/p`);
  });

  // The config dir is ALREADY bind-mounted. Mounting it again because a symlink
  // named it would put the user's credentials at a second container path.
  it("translates a spelling that resolves into the config dir without mounting it again", () => {
    const result = plan([`${HOME}/sneaky`, `${HOME}/sneaky-deep`], {
      [`${HOME}/sneaky`]: CONFIG,
      [`${HOME}/sneaky-deep`]: `${CONFIG}/plugins/marketplaces/mp`,
    });

    assert.deepEqual(result.mounts, [], "the config dir is already mounted; a second mount exposes it twice");
    assert.equal(mappingFor(result, `${HOME}/sneaky`), CONTAINER_CONFIG);
    assert.equal(mappingFor(result, `${HOME}/sneaky-deep`), `${CONTAINER_CONFIG}/plugins/marketplaces/mp`);
  });

  // Windows filesystems are case-insensitive, so these name ONE directory.
  // Containment is case-insensitive too, which made each spelling read as
  // "inside" the other — and the nesting filter dropped BOTH, mounting nothing.
  it("keeps one representative when two Windows spellings differ only in case", () => {
    const winHome = "C:\\Users\\fake";
    const result = externalPluginMounts(["C:\\Dev\\MP", "c:\\dev\\mp"], `${winHome}\\.claude`, "\\", "win32", {
      home: winHome,
      resolveRealPath: (hostPath: string) => hostPath,
    });

    assert.equal(result.mounts.length, 1, "two spellings of one tree must still be mounted");
    assert.deepEqual(
      result.mappings.map((mapping) => mapping.hostRoot),
      ["C:\\Dev\\MP", "c:\\dev\\mp"],
      "both spellings must translate",
    );
  });

  it("gives each tree a stable, distinct container root", () => {
    const first = plan([`${HOME}/dev/a`, `${HOME}/other/a`]).mounts;
    const again = plan([`${HOME}/dev/a`]).mounts;

    assert.equal(new Set(first.map((mount) => mount.containerPath)).size, 2, "same basename, different tree — the hash must separate them");
    assert.equal(first[0]?.containerPath, again[0]?.containerPath, "the same host path must map to the same place every turn");
    first.forEach((mount) => assert.match(mount.containerPath, /^\/mnt\/plugin-src\/[A-Za-z0-9._-]+$/));
  });

  // The readable half is decoration; the hash carries uniqueness. Letting the
  // host path's punctuation through would put it in a mount TARGET.
  it("keeps the host path's punctuation out of the container root", () => {
    const result = plan([`${HOME}/dev/we:ird,name`]);
    assert.match(result.mounts[0]?.containerPath ?? "", /^\/mnt\/plugin-src\/we_ird_name-[0-9a-f]{8}$/);
  });

  // Docker creates the mount TARGET inside the container, and an overlong
  // component fails the whole `docker run` — measured against the daemon:
  // `mkdir …: file name too long`, container never starts. A host basename may
  // sit at the host's own NAME_MAX, and the hash then pushes the target past it.
  // That would cost the SANDBOX, which is exactly what the all-or-nothing rule
  // exists to prevent.
  describe("the container root stays nameable", () => {
    const NAME_MAX = 255;
    const atNameMax = "a".repeat(NAME_MAX);

    it("bounds the whole component when the host basename is at NAME_MAX", () => {
      const result = plan([`${HOME}/dev/${atNameMax}`]);
      const component = (result.mounts[0]?.containerPath ?? "").split("/").pop() ?? "";

      assert.ok(component.length > 0, "the tree must still be mounted, not dropped");
      assert.ok(component.length <= NAME_MAX, `component is ${component.length} bytes, which docker cannot create`);
      assert.match(component, /-[0-9a-f]{8}$/, "the hash must survive truncation — it is what carries uniqueness");
    });

    // Truncation must not become a collision: the hash is taken from the FULL
    // host path, so a shared prefix still separates.
    it("keeps two trees distinct when their names differ only past the budget", () => {
      const first = plan([`${HOME}/dev/${atNameMax}1`]).mounts[0]?.containerPath;
      const second = plan([`${HOME}/dev/${atNameMax}2`]).mounts[0]?.containerPath;

      assert.notEqual(first, second);
    });
  });
});
