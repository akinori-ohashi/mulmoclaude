# SheetJS Community Edition 0.20.3 (vendored)

Unmodified copy of files from the SheetJS CE tarball
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, redistributed under
its Apache License 2.0 (`LICENSE`). This is not an official SheetJS package
and is not affiliated with SheetJS LLC.

| file | tarball path |
|---|---|
| `xlsx.mjs` | `package/xlsx.mjs` |
| `xlsx.d.mts` | `package/types/index.d.ts` |
| `LICENSE` | `package/LICENSE` |

## Why it is vendored

SheetJS publishes fixed versions only on its CDN, not on the npm registry.
npm 12 refuses to install a dependency declared as a remote tarball URL
(`EALLOWREMOTE`), so the `mulmoclaude` launcher cannot depend on it (#3316).
The server only needs `xlsx.mjs`, which has no imports.

## Updating

Bump the root `xlsx` dependency to the new CDN URL, run `yarn install`,
then copy the three files above out of `node_modules/xlsx`.
`test/agent/test_vendoredSheetjs.ts` fails until the vendored `xlsx.mjs`
matches the installed one.
