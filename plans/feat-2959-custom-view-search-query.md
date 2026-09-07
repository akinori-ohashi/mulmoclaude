# Plan: relay the standard table's search box into custom views (#2959)

Give a sandboxed custom collection view read access to what the user typed in
the **standard table view's search box**, so a collection with a custom search
view needs only **one** search box on screen.

Issue: https://github.com/receptron/mulmoclaude/issues/2959

---

## 1. Today's behaviour (the gap)

The search box and the custom view are on screen **at the same time** but share
nothing:

- The query lives in a single ref, `CollectionView.vue:534` (`searchQuery`),
  and drives only `filteredItems` → the table / calendar / kanban bodies.
- `CollectionToolbar` renders while a custom view is active
  (`CollectionView.vue:47` — the `v-if` includes `hasCustomViews`), so the box
  is visible and typing into it does nothing the user can see.
- The iframe is `sandbox="allow-scripts …"` with **no** `allow-same-origin`, so
  it cannot read the parent at all. `window.__MC_VIEW` exposes `slug`, `token`,
  `dataUrl`, `origin`, `onChange`, `openItem`, `startChat`, `t` — no query.

What already exists and is the right rail to build on: the **host → iframe
postMessage relay** for live updates. `CollectionCustomView.vue:159`
(`relayChange`) posts `{ type: "mc-collection-changed", slug }`; the injected
bootstrap (`src/utils/html/customViewSrcdoc.ts:52`) validates
`e.source === window.parent` + `d.slug === v.slug`, debounces, and fires
`onChange` callbacks.

## 2. Decisions

**D1 — one direction only (host → view).** The host's box stays visible while a
custom view renders, so relaying downward fully solves the report. The reverse
(view writes the host's box) would need echo-loop guards, can fight a fast
typist's cursor across an async hop, and adds a new class of message: today's
`mc-open-item` / `mc-start-chat` are *user-gesture proposals*, not silent
mutations of host UI state. A view that wants its own input keeps it local.

**D2 — the initial value travels over the channel, never in the srcdoc.** The
srcdoc is built only inside `load()` (`CollectionCustomView.vue`), which
re-mints a scoped token and reloads the iframe. Baking `searchQuery` into the
boot JSON would mean a token mint + full iframe reload **per keystroke**. So the
boot JSON always carries `searchQuery: ""` and the host seeds the value when the frame claims its port.

**D3 — the channel is a MessagePort, and the first claim on a fresh frame wins.**
*(Revised during review — see the note at the end.)* A window post must name a
target origin, and the frame's origin is opaque, so the only usable target is
`"*"` — which keeps delivering after a view navigates ITSELF elsewhere, handing
the user's typed text to whatever document lands there. So the bootstrap creates
a `MessageChannel`, keeps `port1`, and hands `port2` up in an `mc-view-ready`
ping; a port belongs to the document that received it, so navigation severs it.
A LATER claim means the document changed, and since no injected secret can
identify it (a view can forward anything it holds), the host reinstalls the view
it controls rather than choosing — bounded, so a reloading view cannot mint
tokens forever. The rule is `searchChannelPolicy.ts`.

**D4 — `v.searchQuery` updates immediately; callbacks are debounced (150 ms).**
Same contract as `onChange` ("already debounced — don't add your own throttle"),
but a view that re-reads `v.searchQuery` during its own render always sees the
newest value. The callback also *receives* the query as its argument, so the
common case is a one-liner.

**D5 — hide the toolbar's match count while a custom view is active.**
`CollectionToolbar.vue:214` shows `shown / total` computed from
`itemMatchesQuery` (`packages/core/src/collection/core/textSearch.ts:17`), a
substring match over an item's **scalar** fields only — object/array fields are
skipped. A custom search view typically matches more (show notes, keyword
arrays, nested records), so once the two boxes are linked the host's count and
the view's visible hit count disagree in front of the user. Today nobody expects
them to relate; syncing makes the mismatch read as a bug. The count is also
already meaningless for a custom view (the iframe fetches its own unfiltered
data), so hiding it loses nothing.

**D6 — desktop custom views only; mobile/remote views are out of scope.**
`CollectionRemoteViewPreview` must mirror the phone's capabilities *exactly*
("preview capability must equal phone capability", plans/done/feat-remote-custom-view.md
decision 5), and the phone parent has no search box. Adding the channel to the
preview alone would break that invariant.

## 3. Changes

| File | Change |
| --- | --- |
| `src/utils/html/customViewSrcdoc.ts` | boot JSON gains `searchQuery: ""`; bootstrap opens a `MessageChannel`, hands `port2` up as `mc-view-ready`, and exposes `v.onSearchQueryChange(cb)` |
| `packages/plugins/collection-plugin/src/vue/components/CollectionCustomView.vue` | new `searchQuery` prop; accepts the port, seeds it, relays on change |
| `packages/plugins/collection-plugin/src/vue/searchChannelPolicy.ts` | **new** — `decideSearchChannelClaim`, the pure connect / reinstall / giveUp rule |
| `packages/plugins/collection-plugin/src/vue/components/CollectionView.vue` | pass `:search-query="searchQuery"` to `CollectionCustomView` |
| `packages/plugins/collection-plugin/src/vue/components/CollectionToolbar.vue` | hide the `shown / total` count when a `custom:` view is active (D5) |
| `packages/core/assets/helps/custom-view.md` | document the contract + a worked example |
| `test/utils/html/test_customViewSrcdoc.ts` | shape assertions + behavioural tests that execute the bootstrap against a fake window |
| `test/plugins/collection/test_searchChannelPolicy.ts` | **new** — exhaustive cover of the claim rule |
| `e2e/tests/collection-custom-view-search.spec.ts` | **new** — browser tests: seed, evict a claimant, reconnect on reload |

## 4. Scoping — it closes per collection, for free

`searchQuery` is a single ref reset to `""` on collection load
(`CollectionView.vue:744`) and on slug clear (`:1570`), and is **not**
persisted to localStorage (unlike view mode / sort / flag filters). So the
relayed value is per-collection and per-session by construction; nothing new to
reset. `refreshItemsInPlace` deliberately *keeps* it (`:798`) so a pub/sub
update doesn't wipe what the user is typing — and it doesn't remount the
iframe, so the relay must survive a live data refresh (postMessage does).

The search text no longer travels on the window at all: the port is handed to
one document and belongs to it, so there is no slug to re-check and nothing in
flight across a collection switch can land in the next view. The
`mc-collection-changed` ping still does validate `d.slug === v.slug`, since it
does still travel on the window.

## 5. Verification

- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`.
- Bootstrap behaviour is unit-tested by executing the injected script against a
  fake `window` / `document` / clock — foreign slug ignored, non-parent source
  ignored, debounce collapses a burst, unsubscribe works, `v.searchQuery` tracks
  immediately, and a search query posted on the WINDOW is refused.
- The claim rule has its own exhaustive unit tests (mutation-checked 6/6); the
  browser tests cover what a browser can observe deterministically.
- Manual: a collection with a custom view — type in the standard box, confirm
  the view reacts; switch collections and confirm the query clears.


---

## What review changed (iterations 1–4)

The design above survived; **D3 did not**, and the record should say so rather
than read as if the first attempt was right.

1. **The `"*"` window post leaked.** A custom view may navigate its own frame,
   and `postMessage(…, "*")` keeps delivering to whatever replaces it —
   reproduced: the landing page received
   `{"type":"mc-search-query","query":"secret-term"}`. Fixed with a MessagePort.
2. **First-claim-wins then broke self-reload** — a view calling
   `location.reload()` was refused its new port and went deaf.
3. **A `handshakeNonce` did not fix that**, because anything injected into a
   view can be forwarded by that view to the page it navigates to. No injected
   secret can identify the document in the frame. Replaced by: reinstall the
   view on any later claim, and never decide who is asking.
4. **A vacuous test.** The e2e written to cover the reinstall budget passed with
   the budget at 3 *and* at 9999 — a probe can order messages inside one
   document but not across a frame swap. Deleted; the rule was extracted to
   `searchChannelPolicy.ts` and covered deterministically instead.

**Known limit, costed not fixed:** the bootstrap is injected at the start of
`<head>`, so a `<script>` placed *before* `<head>` in the view's HTML runs
first. Browser-checked: such a script gains nothing (it is the view's own
document, which is entitled to the query, and navigation still severs the port)
— but by claiming first it makes the real bootstrap's claim look like a
re-claim, so that view spends its own reinstall budget and ends up with no
search channel. Moving the injection ahead of `<head>` would also move the CSP
`<meta>`, which is the security boundary for the entire feature and is honoured
only as a child of `head`. Not worth that risk for a view that harms only
itself; the authoring doc now states the ordering accurately instead.
