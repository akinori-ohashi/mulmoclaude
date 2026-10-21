# fix: confine every scoped FileOps by realpath (#3564)

## Problem

`makeFileOps` in `server/plugins/runtime.ts` folds `..` lexically only. A symlink inside the
scope root still reaches outside it, for reads and for writes. It backs:

- `makeArtifactsFileOps()` — html, shapeScript, mulmoScript, chart, presentHtml routes and
  every runtime plugin's `runtime.files.artifacts`
- each runtime plugin's `runtime.files.data` / `runtime.files.config`

#3498 moved the spreadsheet onto a separate `makeConfinedFileOps`; the rest stayed exposed.

## Decision

Fix the factory itself rather than migrating call sites one by one — the issue's own list of
call sites was already incomplete, and a per-site migration leaves the next new caller exposed.

No feature relies on an out-pointing symlink under `artifacts/`: the server creates none, and
`/artifacts/*` static serving already realpath-confines (`resolveArtifactRequestPath`), so such
a link never displayed anyway.

## Shape

One factory, `makeConfinedFileOps(scopeRoot)` in `server/plugins/confined-file-ops.ts`:

1. Lexical step unchanged: `normalizePluginPath` (backslash repair, `..` / absolute rejected
   with `path escapes plugin scope`). It moves into this file next to its only caller.
2. Realpath step on top:
   - read / readBytes / stat / exists / readDir — `resolveWithinRoot`; an escape reads as
     ENOENT (`exists` → false, `readDir` → `[]`)
   - write — `resolveWriteWithinRoot`; an escape throws
   - unlink — confine the PARENT only and unlink the leaf itself, so a link is removed rather
     than its target; a missing parent or file is a no-op

`runtime.ts` uses it for data / config / artifacts. `makeConfinedArtifactsFileOps` goes away;
the spreadsheet dispatch and the plugin create route use `makeArtifactsFileOps` again.

## Out of scope

`makeByPathFileOps` (absolute-path reads for html / shapeScript / mulmoScript) is a different
contract and is not touched here.

## Tests

- `test/plugins/test_confinedFileOps.ts` — symlink escape / in-root link / traversal / Windows
  backslash / unlink-removes-link cases
- `test/plugins/test_plugin_runtime.ts` — existing contract (`escapes plugin scope`, backslash
  paths) keeps passing; import of `normalizePluginPath` follows the move
