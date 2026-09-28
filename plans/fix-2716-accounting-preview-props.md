# plan: the accounting preview card has never rendered a real summary

Tracking: #2716

## What is wrong

`packages/plugins/accounting-plugin/src/vue/Preview.vue` declares

```ts
defineProps<{ data?: unknown; jsonData?: Record<string, unknown> }>();
```

but the only place a `previewComponent` is rendered passes just `:result`:

```html
<!-- src/components/SessionSidebar.vue:64 -->
<component :is="getPlugin(result.toolName)?.previewComponent"
           v-if="getPlugin(result.toolName)?.previewComponent" :result="result" />
```

So both props are always `undefined` and `summarisePreview` always falls through
to its generic branch. Every other plugin declares `result`; accounting is the
only one out of line. Reproduced, not inferred:

```
今サイドバーが出しているもの → pluginAccounting.previewGeneric
正しく渡した場合             → pluginAccounting.preview.bookCreated {"name":"Harness Co","id":"book-1"}
```

## Why no gate caught it

The package DOES run `vue-tsc --noEmit` over `src/**/*`, so the SFC is
typechecked. The mismatch survives because the render site is a **dynamic**
component (`<component :is="...">`), whose props TypeScript cannot check. This
class of bug is structurally invisible to the typechecker and can only be held
by a test.

## #2716's framing was right, and I got it wrong first

I initially claimed the opposite of what follows, and the record is worth
keeping because the mistake is an easy one to repeat.

Reading only the render site, `data` looks irrelevant: `SessionSidebar.vue`'s
`v-if` is `getPlugin(result.toolName)?.previewComponent`, and `sidebarResults`
is `deduplicateResults(toolResults)`, which only collapses consecutive updating
results. Neither mentions `data`. I concluded the card was already there and
that adding `getReport` merely filled it — and an e2e injecting a data-less
envelope "confirmed" it, because injection bypasses the layer that matters.

**The gate is one layer up.** `server/agent/mcp-server.ts` posts a result to the
session only when the handler set `data`:

```ts
if (result.data !== undefined) { … }
```

and its comment names `getReport` as a deliberate narrate-only action. Two more
host sites say the same: `sessionHelpers.ts` ("every result that reaches this
function is intended to surface a card") and `session-store/index.ts` ("Holds
only results that carried `data` — the bridge pushes nothing else"). So a
data-less action produces no card, no `toolResults` entry, and no JSONL line.

Which means the issue's framing holds: **adding `getReport` would ADD a card per
report call.** That is the cost, and it is a product call, not a mechanical fix.
The comment above `PREVIEW_ACTIONS` was correct about the effect and only
imprecise about where the gate lives; it now names the bridge.

**The decision, 2026-09-21: `getReport` stays out.** A card per report read is
noise the LLM's own narration already covers, and the figures reach the model
either way through `message`. It was briefly included in this branch while the
premise above was wrong; removing it is the one-line reversal.

So `summarisePl` and `summariseBs` remain unreachable. They are kept — one line
revives them and their tests pin the formatting for whoever does — but both now
say so in the source, because a tested-but-unreachable branch reading as live is
exactly how #2716 hid for a year. `test_router.ts` asserts the silence rather
than trusting the comment.

## Shape

1. **`Preview.vue` takes `result`** and reads `result.data`, like every other
   plugin preview.
2. **`jsonData` goes.** The router sets `data` and has never set `jsonData`
   (`router.ts:388` is the only writer), so the second prop and the merge inside
   `summarisePreview` are dead. `summarisePreview(data, translate)` loses the
   parameter; `asPayload` stays, since it is what rejects a non-record payload.
3. **`getReport` stays OUT of `PREVIEW_ACTIONS`** — see the decision above. The
   shapes were checked anyway, because the question was live while the premise
   was wrong: `handleGetReport` returns `{ bookId, profitLoss }` /
   `{ bookId, balanceSheet }`, and those carry exactly the fields the two
   summarisers read, so a future reversal produces real text rather than `?`.
4. **The router comment is corrected** to say what the gate actually does.

## The guard — a census, not a spot check

Accounting is one instance of "a preview component whose props do not match the
render site". A fix to that one file leaves the next plugin free to repeat it,
and the typechecker cannot see it.

The built artefacts expose their declared props at runtime, and `dist` is plain
JS, so `tsx --test` can read them without loading an SFC:

```
accounting  {"data":{},"jsonData":{}}   ← the outlier
html        {"result":{}}
chart       {"result":{}}
```

So the test asserts that **every** plugin exposing a `previewComponent` declares
a `result` prop. That holds the class, and it fails for any future plugin that
drifts.

## Verification

- The card is a UI change, so it is checked by rendering it: `e2e/tests/
  accounting-preview-card.spec.ts` drives the real sidebar in a browser. Reading
  the code was what produced the wrong gate claim in the first place.
- Break-verify the census: revert the props to `data`/`jsonData` and watch it go
  red for accounting.
- Break-verify the silence: put `getReport` back into `PREVIEW_ACTIONS` and watch
  `test_router.ts` go red.
- **Do not restate which actions render a card anywhere but `PREVIEW_ACTIONS`.**
  That list went stale in three consecutive review rounds — in the router
  comment, the PR body, a test docblock, the component comment and here. A test
  now walks the set instead, so it is checked by running rather than by
  re-reading five copies.
- **The walk asserts the property, not the set's own definition.** Its first
  version compared the set against "which actions carry `data`", which is
  tautological: `data` is attached *because* the action is in the set, so the
  assertion held with a data-less `getBooks` wrongly a member and caught nothing.
  What it asserts now is what the set is for — a member reaches the card with a
  payload, and the card says something about it. Break-verified with four
  mutations, each confirmed to have landed in the file before measuring: adding a
  member with no call, adding one whose payload no branch reads, removing a
  summariser from the dispatch chain, and shrinking the hold-out list without
  fixing anything. All four go red; the sources restore to their original
  checksums.
- **Three cards say only "book `<id>`"** — `upsertAccount`, `voidEntry`,
  `setOpeningBalances` reach `summariseFallback`'s bare-book branch. Not a
  regression — before this change the component received no props, so these
  rendered the generic "Accounting result" line, which says strictly less than
  the book id does. Verified by running the base `summarisePreview` with the two
  `undefined`s it actually got: it returns `previewGeneric`. Not fixed
  here, because each needs an i18n key in all 8 locales. Pinned as an exact set
  the walk compares against, so it cannot drift in either direction, and tracked
  in #3228.

## Not in scope

- The other plugins' previews — they already declare `result`.
- Whether reads in general should earn a card. `getReport` is the only read this
  touches, and only because its summariser already exists and has never been
  reachable.
