# feat: enrichItems loads only the linked collections the requested fields need

Issue: #3368 (option 2). The cache idea (option 3) is out of scope.

## Problem

`enrichItems` (`packages/core/src/collection/server/derive.ts`) loads every ref / embed
target and backlink / rollup source collection in full on every call. `handleGetItems`
projects to `fields` only AFTER enrichment, so `getItems({ fields: ["title"] })` still
reads and derives every linked collection and then throws the result away.

## Change

- `linkedSlugsForFields(schema, fields?)` in `core/linkTargets.ts` (pure): which linked
  collections a projection to `fields` needs.
  - `fields` omitted → every linked slug (today's behaviour).
  - any requested field is `derived` or `flag` → every linked slug (a formula / predicate
    may deref a ref target or read a rollup; tracing that is not worth the risk).
  - otherwise per requested field: `embed` → `to`; `backlinks` / `rollup` → `from`;
    anything else (stored fields, `toggle`, unknown names) → nothing.
- `enrichItems(collection, items, opts, fields?)` loads only those slugs. Values outside
  `fields` may then be incomplete — callers passing `fields` MUST project to it.
- `handleGetItems` passes its `fields`. `queryRunner` and `remoteView` are unchanged.

## Verification

- Unit tests for `linkedSlugsForFields` in both directions (each kind, derived/flag
  fallback, unknown / prototype-key names, empty list).
- Property test: for every subset of a fixture schema's field names, projecting
  `enrichItems(..., fields)` equals projecting `enrichItems(...)` (the old full load).
- `getItems({ fields: ["title"] })` does not read the linked collection; a backlinks
  field still returns its reverse rows.
