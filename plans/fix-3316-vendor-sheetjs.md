# fix: vendor SheetJS so npm 12 can install the launcher (#3316)

## Problem

npm 12 defaults `allow-remote` to `none`, and the launcher declares
`xlsx` as a CDN tarball URL, so a fresh `npx mulmoclaude` fails with
`EALLOWREMOTE` before anything runs (1.23.0 and 1.24.0 alike).

## Decision

Vendor SheetJS CE 0.20.3 into `server/vendor/sheetjs/` and drop `xlsx`
from the launcher's `dependencies`. Rejected alternatives:
`optionalDependencies` (npm 12 users lose `.xlsx` reading), a
different library (CSV output may change), republishing to npm (one more
package to keep current).

- `xlsx.mjs` — byte-identical to the CDN tarball's file. It has no imports,
  and it is the file Node already resolves for `import "xlsx"` (the
  `exports["."].import` condition), so the runtime code is unchanged.
- `xlsx.d.mts` — the tarball's `types/index.d.ts`, so the typed import keeps
  its types.
- `LICENSE` (Apache-2.0) and `README.md` (provenance and how to update).
- `server/agent/attachmentConverter.ts` imports the vendored file.
- lint / format / duplication tooling ignores `server/vendor/`.

The repo's root `xlsx` dependency stays: yarn installs it, and the client
spreadsheet view is bundled from it at build time.

## Tests

- The vendored `xlsx.mjs` is byte-identical to `node_modules/xlsx/xlsx.mjs`.
  A root `xlsx` bump then fails the test until the vendored copy follows.
- `convertAttachment` turns a generated `.xlsx` into CSV (single and multi
  sheet). No test covered this path before.

## Verification

- Pack the launcher, then on npm 12 do a fresh install with the default
  `allow-remote` and boot it.
- Convert an `.xlsx` inside that install.
