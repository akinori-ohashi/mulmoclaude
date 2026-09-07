# Changelog

Newest first. Each entry corresponds to a tagged release. Written in English.

## @mulmoclaude/core@4.5.0 — 2026-08-30

Three new modules ship here, and the collection plugin and the host both depend on them — this release has to land before either.

**Icons are classified before they are drawn** (#2986, PR #2988; #3003, PR #3006). A `schema.icon` that is not a Material Symbols name — an emoji, most often — used to be handed to the icon font anyway, which rendered it at the font's own metrics and let it overlap the button beside it. `src/collection/core/iconGlyph.ts` decides what a given string *is* before anything renders it, and `src/plugin-vue/IconGlyph.ts` is the component every surface now goes through. Emoji are supported deliberately rather than by accident, the icon-font path carries a11y attributes, a blank fallback no longer produces an empty glyph, and the containment that keeps an oversized glyph inside its box no longer depends on the build configuration.

**Collections and feeds carry an accent colour** (#2987, PR #2998). `src/collection/core/accentColor.ts` holds the parsing and the palette; `schema.ts` / `schemaZ.ts` / `uiTypes.ts` carry the field. Two review findings shaped the final form: the colour was not persisted, and an invalid colour took the whole collection down with it rather than falling back.

**`src/collection/core/shortcutInfo.ts`** is the one place an index row becomes the `{slug, title, icon, color}` that a pinned shortcut reconciles against. The collections index and the feeds index each did this inline, and the subtle half was identical in both: `color` has to be *added* only when there is one and never assigned as `undefined`, because the remote-host handlers pass these shapes through `Jsonify`, which drops `undefined` from a member union. Two copies of that is how they drift.

**Atomic writes retry longer when they can afford to** (#2972 follow-up). `files/atomic.ts` now keeps two rename-retry ladders instead of one. The async ladder grew from ~430 ms to ~4 s because waiting is nearly free there — the call yields — and the old budget was not enough on a loaded Windows CI runner, where the notifier's `active.json` write lost the rename and threw while the contention it was retrying through had long since cleared. The sync ladder stays at ~430 ms on purpose: `sleepSync` parks the whole thread, so a long budget there does not delay one write, it freezes the process. Both budgets are exported so a test can assert what they cost rather than hard-coding a second copy of the numbers.

Help content also moved, and it ships as code through `files: ["dist", "assets"]`: `error-recovery.md` gained a substantial new section, `mulmoscript.md` grew by roughly the same amount, and `bug-report-faq.md`, `business.md`, `gemini.md`, `presentation-deck.md` and `storyteller.md` were all touched. `collection/server/manageTool.ts`, `paths.ts` and `discovery.ts` carry the server-side wiring for the above.

📦 **npm**: [`@mulmoclaude/core@4.5.0`](https://www.npmjs.com/package/@mulmoclaude/core/v/4.5.0)

## @mulmoclaude/core@4.4.2 — 2026-08-26

Documents the search-box relay for custom collection views (#2959, PR #2963) in the help file the agent reads when it authors one.

- `assets/helps/custom-view.md` gains a **One search box** section for the two new `window.__MC_VIEW` fields — `searchQuery` (the live text in the app's own search box) and `onSearchQueryChange(cb)` (fired when the user types there). The point it makes to a view author is _do not build a second search box_: the app's box stays on screen while a custom view renders, so the user already expects it to drive the view. It also records the two behaviours an author has to know — `searchQuery` updates synchronously, so re-reading it inside a render is never a keystroke behind, while the callback is debounced at roughly 150 ms.
- The runtime-contract header was corrected in the same pass. It said the bootstrap runs "before any of your scripts run", which was true in practice but did not say where the boundary is: the host injects at the very start of `<head>`, so anything in `<head>` or `<body>` sees `window.__MC_VIEW`, and only a `<script>` placed _before_ `<head>` would not.

Help content is code as far as releases go — it reaches the agent through `files: ["dist", "assets"]`, so a docs-only change still has to be published. The runtime half of this feature is `@mulmoclaude/collection-plugin@4.4.0` and the host half is `mulmoclaude@1.14.0`; all three shipped together because the feature is incomplete without any one of them.

Every workspace-internal declared range for `@mulmoclaude/core` was swept to `^4.4.2` in the same commit.

📦 **npm**: [`@mulmoclaude/core@4.4.2`](https://www.npmjs.com/package/@mulmoclaude/core/v/4.4.2)

## @mulmoclaude/core@4.4.1 — 2026-08-25

Fixes the scheduler's `interval` due-check, which counted from the current UTC midnight instead of the epoch (#2937, PR #2955). Because `msSinceMidnight` resets to 0 every day and never exceeds 24h, `rounded % intervalMs === 0` could only be true at 00:00 once the interval was a day or longer: every `interval` of 24h or more collapsed into "daily at 00:00" regardless of its value. A skill scheduled `interval 168h` ran 21 times in 21 days — seven times the intended rate, at seven times the API cost. Intervals that do not divide 24h evenly (`7h`, `50m`) drifted the same way, their final window of each day cut short by the midnight phase reset.

`@receptron/task-scheduler` (this monorepo's `packages/scheduler`) already exported `isDueAt()`, the epoch-anchored counterpart of the `nextWindowAfter()` the adapter used for `nextScheduledAt` and catch-up — the host simply never called it, and its private copy drifted. The conversion, the guards and the due-check now live in one place (`packages/core/src/scheduler/schedule-window.ts`), so firing, catch-up and the "next run" the UI shows share a single window definition.

**Behaviour change**: `interval` windows are anchored to the epoch. `interval 168h` fires every Thursday at 00:00 UTC (1970-01-01 was a Thursday) instead of every day; the value the UI already displayed as `nextScheduledAt` is now the value it actually fires on. Intervals dividing 24h (`1h`, `6h`, `30m` — every built-in system task) keep their existing times, and `daily HH:MM` is unchanged. That last claim was proved rather than argued: a differential harness ran the pre-fix `isDue()` beside the new implementation over 1,177,600 generated inputs (valid and malformed times, on- and off-tick offsets, 1s and 60s ticks) with zero divergence on the daily branch, and zero divergence from the library's `isDueAt()` on the interval branch.

### Also in this release

- Catch-up no longer aborts startup on an unusable schedule. `initScheduler()` computes the catch-up plan before the tick engine's guard applies, so a persisted `intervalMs: 0` filled `listMissedWindows()` with `NaN`, hit its cap, and threw `RangeError: Invalid time value` — killing scheduler initialization for every task in the process. Such schedules are now excluded from catch-up (with an error naming the offending field) while remaining registered, which is where the task-manager reports them. Found by Codex review on PR #2955.
- `lastRunAt` now records the window a run belongs to rather than the wall clock. `computeCurrentWindow()` searched forward from "now minus one period", which returns the _preceding_ window when the tick lands exactly on a boundary and _tomorrow's_ window for a daily task read a second late — after which the caller discarded it for the execution timestamp. It now takes the tick's own clock (`TaskRunContext.now`) and the latest window at or before it. Found by CodeRabbit review on PR #2955.
- Daily times outside `[0, 24h)` are rejected instead of wrapping. `"24:00"` resolves to the next day's midnight and `"-1:00"` to the hour before it, so delegating to the library unguarded would have turned a typo that never fired into one firing daily — or 61 times a day.
- Window serialization is guarded against values outside the `Date` range. An `intervalMs` large enough yields a finite next window that `toISOString()` rejects with `RangeError`, which the state writer swallowed along with the entire run record. Found by CodeRabbit review on PR #2955.
- A schedule that can never fire no longer reports a `nextScheduledAt`, and the "this task will never run" diagnostic (#2765) now covers unusable intervals as well as malformed daily times.
- Docs: `docs/task-manager.md` schedule semantics rewritten for epoch anchoring and repointed at the shared helper; `docs/scheduler-guide.md` and `.en.md` gained the anchoring note and dropped an incorrect claim that `daily HH:MM` can select a weekday; `docs/shared-utils.md` catalogues `schedule-window.ts`.

Every workspace-internal declared range for `@mulmoclaude/core` was swept to `^4.4.1` in the same commit.

📦 **npm**: [`@mulmoclaude/core@4.4.1`](https://www.npmjs.com/package/@mulmoclaude/core/v/4.4.1)

## @mulmoclaude/core@3.0.0 — 2026-08-08

Makes the server-side collection engine safely multi-root, so a downstream host (MulmoTerminal) can serve a collection out of any project directory. MulmoClaude's behaviour is unchanged — it is a single-workspace host, it keeps passing no root, and every item is additive with a default that preserves today's path.

**BREAKING** — `isContainedInWorkspace(absPath)` is gone from `@mulmoclaude/core/collection/server`, and `CollectionHost.workspaceRoot` widened to `string | null`. Hence the major bump: a caret range on a 2.x line would otherwise have handed consumers the removal automatically. Every workspace-internal declared range was swept to `^3.0.0` in the same commit.

### From `plans/feat-collection-multi-root.md`

- `CollectionChangePayload` gained an optional `root`, stamped at every publish site (`io.ts`, `sqliteStore.ts`, `collection-watchers/watcher.ts`) with the root the call was given. Absent means "the host's configured root", so a single-workspace host's payload shape is byte-identical to before. Without it, a write to project A's `tasks` refreshes project B's open `tasks` view.
- `CollectionHost.workspaceRoot` accepts `null` — EXPLICIT-ROOT mode. A host that always passes `opts.workspaceRoot` binds `null`, after which `getWorkspaceRoot()` throws instead of silently resolving against another project.
- `collectionsRegistriesConfigPath()` now takes the root explicitly; the registries-config read chain (`loadRegistriesConfig`, `listRegistries`, `findRegistry`, `fetchAllRegistries`, `rawBaseForEntry`, `fetchManifest`, `fetchBundle`, `previewCollection`, `listRegistry`) accepts an optional `RegistryScope` so Discover works under an explicit-root binding. All parameters are optional and default to the host root.
- Removed `isContainedInWorkspace(absPath)` from `@mulmoclaude/core/collection/server`. It had zero callers and checked containment against the AMBIENT root — exactly the silent-wrong-project failure the rest of this change exists to prevent. Use the pure `isContainedInRoot(absPath, rootPath)`.
- The multi-root contract is now stated in the `collection/server/index.ts` module header and pinned by `test/collection/test_multiRoot.ts`.
- `startCollectionWatchers()` throws when called a second time for a DIFFERENT root instead of returning silently, and the generation claim is taken BEFORE the first await, so two concurrent starts cannot both boot and clobber each other's state (the loser's interval would otherwise escape teardown). Roots are compared NORMALIZED — omitting `workspaceRoot` and naming the host's own configured root are the same generation. `stopCollectionWatchers()` is now a production API: `stop()` → `start(otherRoot)` is how a multi-root host switches projects, it awaits a boot still in flight, and it releases the root claim.
- New `WATCHER_ROOT_CONFLICT` (`@mulmoclaude/core/collection-watchers`) and `COLLECTION_ROOT_REQUIRED` (`@mulmoclaude/core/collection/server`) `err.code` values, plus `peekWorkspaceRoot()` — a non-throwing root read for comparisons. "another root's watcher is running" and "this call forgot its `workspaceRoot`" need different fixes, and a host that catches watcher startup in one fire-and-forget `.catch` should not have to match message text to tell them apart. `collection-watchers` holds one watcher generation per process, so the quiet version left the second root's direct file writes emitting neither live-refresh events nor completion bells. Making watchers genuinely concurrent is separate work: `reconciler.ts` derives each bell's identity from `completionLegacyId(slug, itemId)` and the host adapter takes the same pair, so two roots owning one slug collide on a HOST-FACING contract, not just on a watcher slot.

📦 **npm**: [`@mulmoclaude/core@3.0.0`](https://www.npmjs.com/package/@mulmoclaude/core/v/3.0.0)

## @mulmoclaude/core@0.8.2 — 2026-07-04

Restores the `computeCollectionIcon` export that was published to the workspace source in PR #1957 (dynamic collection icons) but never reached the npm tarball. The mulmoclaude launcher's tarball smoke was failing with `SyntaxError: does not provide an export named 'computeCollectionIcon'` on every push against `@mulmoclaude/core@0.8.1`.

### From PR #1957 — feat(collections): dynamic collection icons based on data state

- Collection schemas can declare an optional `dynamicIcon` block; launcher shortcut icons then reflect the current state of a source collection's data (weather forecast, todo completion state, etc.).
- Reuses the existing `CollectionWhen` `{field, in}` predicate for `rules`; absent `dynamicIcon` = static `schema.icon` (unchanged).
- New public exports on `@mulmoclaude/core/collection/server`: `computeCollectionIcon`.
- New public exports on `@mulmoclaude/core/collection`: `dynamicIcon.ts` pure resolver + `where.ts` predicate helper.
- `CollectionSummary.iconSources` tells the client which collection channels to watch for reactive icon refresh.

📦 **npm**: [`@mulmoclaude/core@0.8.2`](https://www.npmjs.com/package/@mulmoclaude/core/v/0.8.2)
