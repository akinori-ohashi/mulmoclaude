# plan: test files are not typechecked in any package that builds with tsc

Tracking: #3222

## What is wrong

`yarn typecheck` does not look at `test/` in 19 workspace packages. Each one's
`tsconfig.json` is the BUILD config — `rootDir: "src"`, `outDir: "dist"`,
`include: ["src"]` — and the `typecheck` script is `tsc --noEmit` against that
same file. So the include that is correct for the build silently decides what
gets typechecked.

Nothing else covers the gap: `tsx --test` strips types without checking them, and
`eslint src test` runs no type-aware rules.

## Reachability — measured, not argued

Appending `const deliberate: number = "not a number";` to a test file and running
each package's CURRENT `typecheck` script leaves it green. Done on three packages
picked from different families:

| package | current `typecheck` catches it | a config including `test/` catches it |
|---|---|---|
| `packages/bridges/slack` | no | yes |
| `packages/common` | no | yes |
| `packages/protocol` | no | yes |

This is not hypothetical damage either: #3219 added a test file carrying **six**
real type errors — a private-member access and `parentId` read off a `Channel`
union where `DMChannel` does not declare it — and `yarn lint`, `yarn build`,
`yarn typecheck` and `yarn test` were all green on it.

## Scope — 19 packages, not the 8 the issue says

The issue was filed naming eight bridges. That was an undercount: the survey below
is every workspace with a `test/` directory whose tsconfig excludes it.

Bridges: `cli` `discord` `line` `mastodon` `slack` `teams` `telegram` `xmpp`
Others: `chat-service` `client` `common` `create-mulmoclaude-plugin`
`markdown-utils` `mock-server` `protocol` `relay` `scheduler` `web-push`
`webhook-runtime`

**The repo already has the right pattern** — `packages/core` and the plugins use
`include: ["src/**/*", "test/**/*"]`. They can, because they build with **vite**
and their tsconfig is `noEmit: true`, a typecheck config and nothing else. The 19
here build with **tsc**, so one file serves both jobs and cannot simply gain
`test/`: `rootDir: "src"` makes a file under `test/` an error (TS6059, confirmed),
and without `rootDir` the tests would be emitted into `dist` and shipped, since
these packages publish `files: ["dist"]`.

## Shape

A second config per package, `tsconfig.typecheck.json`, leaving the build config
untouched:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": ".", "allowImportingTsExtensions": true },
  "include": [/* the package's own include entries */, "test/**/*"]
}
```

and `"typecheck": "tsc -p tsconfig.typecheck.json"`.

Three choices worth stating:

- **It extends the package's OWN tsconfig, not the shared base.** Three of the 19
  carry package-specific options — `markdown-utils` sets `lib`, and `relay` and
  `create-mulmoclaude-plugin` are standalone configs with a dozen each. Extending
  the shared base would silently typecheck those three under different options
  than they build with.
- **`rootDir: "."` is required, not tidiness.** Inheriting `rootDir: "src"` makes
  every test file TS6059. Verified.
- **`allowImportingTsExtensions` is needed** — 11 of the 19 import `../src/x.ts`
  with the extension. It is inert in the other 8, and keeping all 19 files
  identical is worth more than trimming a line from eight of them.

## What the gate finds: 104 errors in 8 of the 19

| package | errors | | package | errors |
|---|---:|---|---|---:|
| `chat-service` | 59 | | `teams` | 3 |
| `telegram` | 15 | | `line` | 2 |
| `scheduler` | 11 | | `webhook-runtime` | 2 |
| `web-push` | 7 | | the other 11 | 0 |
| `client` | 5 | | **total** | **104** |

By kind, they are concentrated rather than varied:

| code | count | what it is |
|---|---:|---|
| TS2532 / TS18048 | 57 | "possibly undefined" — `noUncheckedIndexedAccess` on `arr[0]` |
| TS2322 | 28 | not assignable, mostly the same indexed-access shape one level out |
| TS2379 / TS2375 / TS2412 | 13 | `exactOptionalPropertyTypes` |
| other | 6 | one-offs |

**A measurement note, because it nearly shipped as a false claim.** The first pass
reported zero errors everywhere. It was counting with `grep -cE "error TS"` against
tsc's coloured output, where an ANSI escape sits between `error` and ` TS`, so the
pattern matched nothing and every package looked clean. `--pretty false` is what
makes the count real. A zero from a filter that cannot match is indistinguishable
from a zero from clean code — the same trap as a test that passes because its
matcher is broken.

## Fixing the errors without weakening the tests

Most of these are a test reaching into a fixture array — `roles[0]` — which is
`T | undefined` under `noUncheckedIndexedAccess`. The tempting fix is `!`, which
silences the checker and asserts nothing. The fix used here is `assert.ok(...)`
where a value must exist, so the test states the precondition it was already
relying on and fails with a message instead of a `TypeError` when it stops
holding.

A fix must never turn a real assertion into a weaker one. Anywhere the obvious
change would do that, restructure the fixture instead.

## Verification

1. **Detection, per package.** Inject a deliberate type error into one test file,
   confirm the new `typecheck` script goes red, restore, confirm green. Do it for
   all 19, not a sample — a config that matches nothing reports zero errors, which
   is indistinguishable from a clean package.
2. Confirm the tree is byte-clean after each injection/restore cycle.
3. `yarn typecheck` at the repo root — the aggregate must stay green.
4. `yarn build` for a package whose config changed, and confirm `dist/` contains
   no test output.

## Not in scope

- The root `test/`, `e2e/` and `e2e-live/` trees — those already have their own
  typecheck jobs (`typecheck:test`, `typecheck:e2e`, `typecheck:e2e-live`).
- Packages already including `test/**/*` (`core`, the plugins). Nothing to do.
- Production source. The 104 errors are all in `test/`; `src/` was already
  typechecked in every one of these packages and none of it changed here.
  (This bullet used to say "there are none to fix" — written against the first,
  wrong measurement, before `--pretty false` showed the real count.)
