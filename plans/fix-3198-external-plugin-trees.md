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
   ones that are absolute, traversal-free, outside the config dir, resolvable,
   and not sensitive ONCE RESOLVED, drops any nested inside another kept one,
   and assigns each a container root `/mnt/plugin-src/<safe-basename>-<hash>`.
   A tree carries its `aliases` (the ledger spellings) separately from its
   `mountSource` (the resolved path), because the two ledgers may spell one
   directory differently and both have to translate.
4. **`pluginLedgerMountArgs`** reads BOTH ledgers before translating either,
   because the trees to mount are a property of the pair: a marketplace's
   `installLocation` and its plugins' `installPath`s live in different files and
   have to agree about where the tree landed. Tree mounts come first in the argv;
   the ledger copies overlay files inside the config-dir mount, and an overlay
   has to follow what it sits on.

**All or nothing.** If any required mount cannot be expressed as a docker
argument, nothing is staged. A ledger pointing into a mount that does not exist
is worse than not translating it — the host path at least existed.

Codex raised the one case where resolving makes this stricter: an alias that IS
expressible whose realpath is NOT — a resolved path holding both a colon (which
rules out `-v`) and a comma (which rules out `--mount`). That now costs the
mount where binding the alias would have worked. Kept deliberately, and pinned
by a test rather than left to be rediscovered: the alternative is staging a
safe-named symlink to bind through, which buys a rarity at the price of a
symlink farm to create and clean up, and skipping is what the rest of this
module already does with a path no flag can carry.

## Security

### The gate runs on what Docker BINDS, not on what the ledger says

Found in review, and the reason the shape above has a resolver in it at all.
`isSensitiveMountPath` is lexical — it never touches the filesystem — so a
ledger naming `~/dev/mp` passes every check while Docker, which resolves the
source itself, hands the container whatever that symlink points at. Measured
against the daemon rather than argued:

```
$ ln -s "$PWD/secret-dir" innocent-looking-plugin
$ docker run --rm -v "$PWD/innocent-looking-plugin:/mnt/probe:ro" alpine \
    cat /mnt/probe/id_rsa
TOP-SECRET-KEY-MATERIAL
```

So every candidate is resolved first, the blocklist is asked about the resolved
path, and the resolved path is what gets bound. The resolver is injected, which
keeps the decision logic pure and makes the rule assertable without building a
symlink farm.

The same escape exists in `reference-dirs.ts`, the blocklist's other caller. It
is **not** fixed here — issue #3200 — because the fix moves that feature's label,
container hash, dedup key and prompt/UI/`/api/sandbox` agreement, which is
independently revertable from this change. To stop it being an invisible trap,
`isSensitiveMountPath` now says in its own contract that it is lexical and that
a caller who mounts must resolve first.

### Otherwise

Mounting a host path the user chose, read-only. Not a new class:

- the sandbox **already** mounts `~/.claude` read-write, `.credentials.json`
  included, so a read-only plugin tree is a smaller exposure than what is there
- a plugin is code the agent already runs when it lives in the config dir
- the blocklist is the one reference directories use: `$HOME` itself, `.ssh`,
  `.aws`, `.gnupg`, `.config/gh`, `.kube`, `.docker`, the system directories, and
  the filesystem root

## Two things found while building it

- **Two Windows spellings of one tree annihilated each other.** Containment is
  case-insensitive on Windows, so `C:\Dev\MP` and `c:\dev\mp` each read as
  "inside" the other and the nesting filter dropped BOTH — the tree was never
  mounted at all. Trees are now grouped by MUTUAL containment, so one directory
  is one mount carrying every spelling that named it. Found by review; it needed
  the `isAbsolute` fix below before a POSIX runner could even express the case.
- **`isAbsolute` and `basename` were host-bound too.** The same defect as the
  blocklist one below, in the same file: a `platform` argument that does not
  select the path implementation changes nothing, and on a POSIX runner
  `C:\Dev\MP` reads as a relative path with no directory part.
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
  stability and collision-freedom, a tree that is not on the host, a symlink to
  each blocked class refused, the resolved path being what is bound, two
  symlinks to one tree sharing a mount, and the Windows case-variant pair.

One existing test **inverted**: it asserted that an external-only ledger produces
no mounts. That was the limitation this change removes, encoded as an
expectation — worth saying plainly rather than quietly editing.

## Verification

Against the real daemon, through the argv this code builds: an external
marketplace loads with its MCP server `connected`, its commands, its skill and
its hook. A ledger pointing at a symlink to the real `~/.ssh` produces no mount
at all, with a warning naming the resolved target. The user's real `~/.claude`
still produces exactly two mounts and all four of their plugins, so the
in-config path is unchanged.

Each fix is break-verified by mutation, restoring from a pristine copy between
cases and confirming the tree is clean again at the end: checking only the alias,
binding the alias instead of the resolved path, grouping by exact string, and a
platform-blind `isAbsolute` each turn tests red.

The blocklist extraction's behaviour-preservation claim is proved by running the
pre-change `isSensitivePath`, copied verbatim, beside the extracted one over
generated inputs — every blocked class, the near-misses, and the suffixes that
decide the trailing-separator guard. They agree on all of them.
