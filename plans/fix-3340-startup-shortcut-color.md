# fix: collection shortcut accent colour wiped at startup (#3340)

## Problem

Pinned collection shortcuts lose their `color` on every app start; it comes
back only after opening the Collections index. Feed shortcuts are unaffected.

## Root cause

`useDynamicShortcutIcons.refresh()` runs on app mount and reconciles
`"collection"` shortcuts against `listCollections()`, but builds the rows by
hand as `{ slug, title, icon }` — no `color`. `reconcileShortcuts` sees the
persisted colour disagree with the (absent) live one, rebuilds the entry
without it and `persist`s the file. `CollectionsIndexView` reconciles through
`toShortcutInfo()`, which carries `color`, so it restores it. Feeds are
excluded from the startup refresh, which is why their colour survives.

The hand-built mapping predates `toShortcutInfo` (#1900 vs #2998) and was
missed when the index views moved to it. It is the only reconcile caller not
going through `toShortcutInfo`.

## Fix

- Extract the row mapping into a pure helper
  `src/composables/collections/collectionShortcutRows.ts` that goes through
  `toShortcutInfo(summary, "dataset")` — the same call and fallback icon
  `CollectionsIndexView` uses, so startup and index visit reconcile against
  identical rows.
- Route `useDynamicShortcutIcons.refresh()` through it.

## Test

`test/composables/test_collectionShortcutRows.ts`: the mapping carries
`color`, omits it (no key) when absent, and — the property that matters —
reconciling a coloured pinned shortcut against the rows does not drift.
