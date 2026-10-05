# fix: accounting preview cards say what the action did (#3228)

## Problem

`upsertAccount`, `voidEntry` and `setOpeningBalances` render a preview card, but
`summarisePreview` had no branch for their payloads, so each card fell through to
`summariseFallback` and read only "Accounting · <bookId>".

## Change

- `src/vue/previewSummary.ts`: one `summarise*` branch per action, keyed on the
  payload shape the service returns (same style as the existing branches):
  - `summariseAccount` — `account.code` / `account.name` → `preview.accountSaved`
  - `summariseVoid` — `reverseEntry.date` → `preview.entryVoided`
  - `summariseOpening` — `openingEntry.date`, and `replacedExisting === true`
    picks `preview.openingReplaced` over `preview.openingSet`
- The four keys added to all 8 locales.
- `test_router.ts`: the `BARE_BOOK_ONLY_ACTIONS` exact-set is gone (it would be
  empty); the walk now asserts per action that no card reaches the bare-book line.
- `test_previewSummary.ts`: each new branch, normal and malformed payloads.

## Out of scope

- No version bump / publish of `@mulmoclaude/accounting-plugin`; that is a
  separate `chore(release)`.
- `upsertAccount` does not distinguish create from update: the service does not
  return that, and the issue asks only for code and name.
