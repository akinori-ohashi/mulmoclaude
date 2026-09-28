# fix(core): `collection/server` must load without the optional `firebase` peer (#3263)

## The report, and where it was right

`@mulmoclaude/core` declares `firebase` as an OPTIONAL peer. Importing
`@mulmoclaude/core/collection/server` nevertheless failed at load for a consumer
without it (`ERR_MODULE_NOT_FOUND`), which is what blocked `@receptron/sharedapp`
(receptron/sharedapp#84) from moving to core 5.

The report is right about the cause class and right about the invariant: the
barrel in `collection/server/index.ts` already SAID no SDK import may be reachable
from it, and the graph below it broke that sentence.

## Where it was wrong, and why the shape of the fix differs

The report names `export { sharedItemsPath } from "./firestoreStore"` as the link
and proposes moving that one function to a firebase-free module.

Measured, that fix does not work. Removing only that line and rebuilding leaves
the entry failing exactly as before, because `store.ts` ALSO reaches the same
module — the backend factory registry names `firestoreStoreFor` — and the barrel
does `export * from "./store"`. `sharedItemsPath` was one of two doors into a
module that needed the SDK; closing it leaves the other open.

So the fix is at the module, not at the barrel: `firestoreStore.ts` stops needing
`firebase` at all.

## What the sweep found

Loading every declared subpath with `firebase` made unresolvable, before and
after. Before, the entries that could not load were:

`google`, `collection/server`, `collection/firestore`,
`collection/registry/server`, `feeds/server`, `collection-watchers`,
`remote-host`, `remote-host/server`

After, exactly three — and each one's NAME says it needs the SDK:

`collection/firestore`, `remote-host`, `remote-host/server`

The reported subpath was one of six casualties of a single import. That is the
evidence the fix sits at the right layer.

## The change

`firestoreStore.ts` needed one SDK VALUE — `Timestamp`, to hand Firestore back
its own type when re-writing a frozen server-time field. Its own header already
said SDK access goes through the `FirestoreDocs` seam; the `Timestamp` import was
the exception that broke the entry.

- `FirestoreDocs` gains `timestamp(seconds, nanoseconds) => unknown`. The real
  adapter (`createFirestoreDocs`, which lives behind the SDK-named
  `collection/firestore` subpath) implements it with `new Timestamp(...)`.
- `firestoreStore.ts` drops the `firebase/firestore` import and builds the value
  through `docs.timestamp(...)`. Nothing else about the module changes; needing
  an instant was correct and stays correct.
- The test fakes return the structured-clone shape `{ seconds, nanoseconds }`,
  which is what the codec duck-types on (`collection/core/serverTime.ts`), plus
  a marker so a test can tell a value that came back through the seam from one
  that merely looks like an instant. Two tests carry what the fakes no longer
  can: `packages/core/test/collection/test_firestoreDocs.ts` pins that the REAL
  adapter builds Firestore's own class, and the store-contract suite pins the
  delegation — the parts handed over are the ones the decode produced, and what
  comes back is what gets stored. Both were confirmed to go red with the fix
  reverted.
- `sharedItemsPath` stays where it is. Once the module holds no SDK import there
  is nothing to move it away from, and moving it would not have fixed anything.

## The guard

`test/workspace/collections/test_optionalFirebasePeer.ts` loads EVERY entry of
the exports map — read from `packages/core/package.json`, so a new entry is
covered the day it is declared — under `import` and under `require`, in a child
process whose resolver refuses `firebase`. That is what a consumer without the
peer sees. A hook rather than a fixture tree because Node resolves from the
importer's real path — a temp directory that omits firebase still finds the copy
this checkout installed.

It sweeps rather than naming `collection/server` because the one import took
down six entries, and a guard written around the entry that happened to be
noticed would have missed the other five.

The hook is `module.registerHooks` (synchronous), not `module.register` (async).
Only the synchronous kind reaches `require()`, and the package ships a CommonJS
build that has to hold the same line — reverting the fix shows the `.cjs` chunk
failing exactly as the `.js` one does. A CJS sweep built on the async API passes
whether or not the entry needs firebase; measured, `require` of
`collection/firestore` succeeds under it.

It carries a CONTROL in each condition: the entries whose name says they need the
SDK must still fail, with `ERR_MODULE_NOT_FOUND` naming firebase. Without it, a
green sweep could equally mean the hook never fired — which is exactly what the
async API would have produced under `require`.

Confirmed both directions: green with the fix, red with the fix reverted (the
control stays green in both).

## Why nothing caught this before

- `typecheck` cannot: types erase, so a value import that will fail at load
  type-checks fine.
- This repository's tests cannot: MulmoClaude installs firebase, so the entry
  always resolves here. MulmoTerminal is the same. The contract held nowhere and
  looked healthy everywhere.
- Writing the invariant down did not either — it was written, and broken seven
  lines below.

## What this breaks, deliberately

`FirestoreDocs` gains a member, so a host that HAND-WROTE the interface fails to
compile on upgrade. Everything in this repository builds it through
`createFirestoreDocs`, and so does MulmoTerminal's production wiring
(`server/backends/sharedCollections.ts`) — but MulmoTerminal's
`test/server/infra/sharedAppTool.spec.ts` has a literal `FAKE_DOCS` that will
need the member added.

Made required rather than optional on purpose. A fallback would have to invent
an instant without the SDK, and a plain object written where a `Timestamp`
belongs is refused by the rules that freeze that field — so the record becomes
permanently unupdatable, silently. A compile error is the better failure.

## What the guard does NOT cover

It reads `packages/core/dist`, so it answers for whatever build is on disk. CI
builds the workspace packages before the test step; run by hand on a stale
`dist` it reports the old artifact, and nothing in the result says so. Noted
rather than fixed: the obvious fix is comparing mtimes, and CI restores `dist`
from a cache whose timestamps would make that check fire on a perfectly good
build.

## Follow-up (not in this PR)

`@receptron/sharedapp` is unblocked only once a core carrying this reaches npm.
The publish is its own `chore(release)`.
