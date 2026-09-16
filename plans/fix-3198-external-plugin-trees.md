# fix(sandbox): mount plugin trees registered from outside the config dir (#3198)

## Symptom

`claude plugin marketplace add <local path>` pointing outside `~/.claude` gives a
plugin that works on the host and is **inert in the sandbox**. #3186 fixed the
ledger's host paths, but only for values under the config dir; a tree elsewhere
is not carried by any mount, so there is nothing to translate them to.

This is the plugin author's ordinary workflow — point the CLI at your working
tree — so it is not an exotic configuration.

## I was wrong about this twice, and the correction is the point

In #3186 and again in #3191 I wrote that the tree "isn't mounted, so no spelling
helps". That turns a statement about the CURRENT state into a claim of
impossibility. Measured: mount the tree at a container path, translate the two
ledger keys to it, and the plugin loads end to end — MCP server `connected`,
both slash commands, the skill, the `SessionStart` hook.

## Approach

1. **`server/utils/sensitiveMountPaths.ts`** — the blocklist that decides which
   host paths may be mounted, lifted out of `reference-dirs.ts`. It had one
   caller; plugin trees are a second, and a security rule with two copies is one
   that drifts.
2. **`toContainerPath(mappings, value, sep)`** generalises `toContainerConfigPath`
   from one root to several. The **longest** matching root wins, so the caller
   cannot get the order wrong. `toContainerConfigPath` remains as the
   single-mapping case, which is what keeps its existing tests meaningful.
3. **`externalPluginTrees(...)`** collects the ledger's recorded paths, keeps the
   ones that are absolute, traversal-free, outside the config dir and not
   sensitive, drops any nested inside another kept one, and assigns each a
   container root `/mnt/plugin-src/<safe-basename>-<hash>`.
4. **`pluginLedgerMountArgs`** reads BOTH ledgers before translating either,
   because the trees to mount are a property of the pair: a marketplace's
   `installLocation` and its plugins' `installPath`s live in different files and
   have to agree about where the tree landed. Tree mounts come first in the argv;
   the ledger copies overlay files inside the config-dir mount, and an overlay
   has to follow what it sits on.

**All or nothing.** If any required mount cannot be expressed as a docker
argument, nothing is staged. A ledger pointing into a mount that does not exist
is worse than not translating it — the host path at least existed.

## Security

Mounting a host path the user chose, read-only. Not a new class:

- the sandbox **already** mounts `~/.claude` read-write, `.credentials.json`
  included, so a read-only plugin tree is a smaller exposure than what is there
- a plugin is code the agent already runs when it lives in the config dir
- the blocklist is the one reference directories use: `$HOME` itself, `.ssh`,
  `.aws`, `.gnupg`, `.config/gh`, `.kube`, `.docker`, the system directories, and
  the filesystem root

## Two things found while building it

- **The Windows rule was not actually assertable.** `isSensitiveMountPath` took a
  `platform` argument, but used the ambient `path`, whose `resolve` / `join` /
  `sep` are host-bound — so on a POSIX runner the argument changed the case
  folding and nothing else. It now selects `path.win32` / `path.posix`, which is
  the discipline `toPosixRelPath` established here. The Windows tests fail
  against the previous shape.
- **The blocklist had no test seam, and that is #3196's root cause.** macOS
  `os.tmpdir()` resolves under `/var`, which the list blocks — correctly — so a
  test cannot build a fixture in a temp directory. The only way out was writing
  under `$HOME`, which is exactly what stops a sandboxed reviewer running such a
  file. `systemBlocked` is now injectable, so these tests run anywhere.

## Tests

- `test/utils/test_sensitiveMountPaths.ts` — every blocked class, the
  `/etc-backup` near-miss, the macOS temp-directory case, the injected-list seam,
  and the Windows rules from a POSIX runner.
- `test_plugin_ledger_paths.ts` — several mounted roots, longest-match regardless
  of caller order, traversal below a matched root.
- `test_plugin_ledger_mount.ts` — a tree mounted and the ledger pointed into it,
  mount ordering, a sensitive tree refused, dedup and nesting, container-root
  stability and collision-freedom.

One existing test **inverted**: it asserted that an external-only ledger produces
no mounts. That was the limitation this change removes, encoded as an
expectation — worth saying plainly rather than quietly editing.

## Verification

Against the real daemon, through the argv this code builds: an external
marketplace loads with its MCP server `connected`, its commands, its skill and
its hook. The user's real `~/.claude` still produces exactly two mounts and all
four of their plugins, so the in-config path is unchanged.
