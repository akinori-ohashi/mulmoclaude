# fix(sandbox): build every `-v` source from the host path without corrupting it (#3191)

## Symptom

Three helpers build Docker mount sources by replacing every backslash with `/`,
**unconditionally, on every platform**, and all of them emit `-v`. On POSIX a
backslash is an ordinary filename character, so the conversion rewrites a real
path into one that does not exist; and `-v` splits its fields on `:`, which a
POSIX path may legally contain.

| site | mounts it builds |
|---|---|
| `server/agent/config.ts` (`toDockerPath`) | workspace, `node_modules`, `server/`, `src/`, `packages/`, `~/.claude`, `~/.claude.json` |
| `server/agent/sandboxMounts.ts` | `SANDBOX_MOUNT_CONFIGS` (`gh`, `gitconfig`), SSH agent socket |
| `server/workspace/reference-dirs.ts` | user-configured reference directories |

## What it costs, measured

- **Backslash — silent.** Docker creates the rewritten path as a fresh empty
  directory and mounts *that*. The container starts, exit code 0. Measured on a
  workspace mount: the container saw an empty directory while the real workspace
  held its files, and a file the container wrote landed in the phantom directory
  on the host. **The agent sees an empty workspace and its work goes somewhere
  else.** Nothing reports a failure.
- **Colon — loud.** `docker run` refuses the whole command, so the sandbox does
  not start. `buildExitErrorEvent` forwards Docker's message, so at least the
  user sees something.

## Reachability

Not limited to hand-edited config:

| mount | where the path comes from | user-supplied? |
|---|---|---|
| reference directories | a Settings-UI text field | **yes** — `validateEntry` checks absolute / `..` / sensitive, and lets `:` and `\` through |
| workspace | `MULMOCLAUDE_WORKSPACE_PATH`, used verbatim with no validation | **yes** |
| `~/.claude`, `.claude.json` | `CLAUDE_CONFIG_DIR` | **yes** |
| app paths, `gh`/`gitconfig`, SSH socket | install location, `homedir()`, `SSH_AUTH_SOCK` | indirect / rare |

Reference directories also carry the defect into the **target**: `containerPath()`
builds it from `path.basename(hostPath)`, which never goes through the
conversion — so the two sides disagree about how the path is spelled.

## Decision: pick the flag per path, do NOT switch wholesale to `--mount`

The obvious fix is "use `--mount`, it handles colons". Measured against the
daemon, that trades one broken case for another:

| character in the path | `-v` | `--mount` |
|---|---|---|
| `"` | **works** | fails (its CSV reader rejects a bare quote) |
| `,` | **works** | fails (field separator) |
| `:` | fails | **works** |

The two flags are **complementary**. Switching everything to `--mount` would fix
colons and **break paths containing a comma or a quote that work today**. That is
a swap, not a fix.

So the rule is: **`-v` unless the path forces `--mount`.**

```
neither side contains ":"                    → -v        (status quo; no existing path changes)
otherwise, neither side contains , " or ctrl → --mount    (fixes today's broken case)
otherwise                                    → inexpressible
```

Every path that works today keeps taking the same `-v` it takes now. Only paths
that are broken today change behaviour. The inexpressible residue is a path
holding both a colon and a comma/quote, which is broken today too.

### `-v`'s implicit create-if-missing is not a hazard here

`-v` silently creates a missing source; `--mount` errors. Every mount this
codebase builds is already guaranteed to exist by the time it is built:
workspace via `mkdirSync` at startup, `~/.claude` and `.claude.json` via
`assertClaudeFiles()` (which `process.exit(1)`s), `packages/` and nested
`node_modules` and workspace modules via `existsSync`, reference dirs and
`gh`/`gitconfig` by being skipped when absent, the SSH socket via `existsSync`
on Linux. The macOS magic socket does not exist on the host and was measured to
work under `--mount` anyway. Where the difference *is* reachable, erroring is the
improvement — #2654 is the report that a missing `.claude.json` becomes a silent
empty directory.

## Approach

1. **`server/agent/dockerMount.ts` — pure, no fs.** One place that turns
   `{hostPath, containerPath, readOnly}` plus a platform into either mount
   arguments or an "inexpressible" result carrying the reason. Holds the
   separator rule (Windows only) and the flag-selection rule above. The platform
   is a parameter so the Windows behaviour is assertable from a POSIX runner.
2. **Essential vs skippable, because they must differ.** A mount the sandbox can
   run without is skipped with a warning; one it cannot is refused with an error
   naming the path and the character, rather than emitting a spec Docker will
   reject with its own wording.
   - skippable: reference directories, `gh`/`gitconfig`, SSH socket, plugin ledgers
   - essential: workspace, `~/.claude`, `.claude.json`, the app's own paths
3. **`containerPath()` sanitises the basename.** The target is a name we
   synthesise and uniqueness already comes from the hash, so reducing the
   decorative half to a safe character set is lossless.
4. **Retrofit `pluginLedgerMount.ts`** onto the shared helper. #3188 shipped it
   using `--mount` unconditionally, which skips a staging path containing a comma
   that `-v` would have carried. Not broken, but strictly improvable, and leaving
   two rules in the tree is how they drift.

## Not doing

- **Rejecting these characters in the reference-dir UI.** Refusing a legitimate
  path the user actually has is a worse outcome than mounting it correctly, and
  the fix makes it mountable. Only the genuinely inexpressible combination is
  refused, at mount-build time, with a reason.
- `server/plugins/runtime.ts` and `server/api/routes/files.ts` also replace
  backslashes, but they normalise workspace-RELATIVE paths into a POSIX contract
  rather than building a mount source. Different question — check separately.

## Tests

Against the pure module: each character class under each flag, the platform gate
(a POSIX backslash survives, a Windows backslash converts), both sides checked
(a colon in the target forces `--mount` too), and the inexpressible case. Plus
per-call-site tests that a skippable mount is skipped and an essential one
raises.

**A green suite proves little here** — every path without an unusual character
behaves identically, which is nearly every real path. The tests that matter are
the ones that place the character deliberately, and the end-to-end run below.

## Verification

Beyond unit tests, drive the real daemon: a workspace whose path contains a
backslash must show its own files inside the container (today it shows an empty
directory), and one containing a colon must start at all. Compare against the
same workspace at a clean path as the control.
