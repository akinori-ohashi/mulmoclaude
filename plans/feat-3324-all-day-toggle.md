# feat: an All day toggle for datetime fields in the record form (#3324)

## Problem

Since #3304 a `datetime` field accepts a bare `YYYY-MM-DD` (all day), but the
form offers no way to switch between a timed value and a bare date. The
calendar's Add affordance seeds `…T00:00`, which pushes to Google as a timed
midnight event.

## Decision (agreed on the issue)

An **All day** checkbox beside each top-level `datetime` input that is not a
server-stamped instant.

- `withAllDay(value, allDay)` (pure, in `useCollectionRendering.helpers.ts`):
  checking drops the clock, and unchecking appends `T00:00`. An empty,
  unreadable or server-stamped value is returned unchanged.
- `isAllDayValue(value)`: a real bare date.
- `CollectionRecordPanel.vue` keeps the keys ticked in this draft
  (`allDayKeys`, reset when the draft changes), so a new record can be all day
  before a date is picked. The checkbox is checked when the key is ticked or
  the value is a bare date.
- Two inputs (`date` / `datetime-local`) under `v-if` / `v-else`, not one input
  with a bound `type`. Switching a live input's type let the browser drop the
  converted value as invalid for the old type, and the field rendered blank
  (caught by the e2e test).
- The Add affordance keeps seeding `T00:00`, and the user can tick All day.
- Label `collectionsView.allDay` in all 8 locales. `helps/google-calendar-collection.md`
  mentions the checkbox.

## Out of scope

Table-row `datetime` sub-fields and the action-parameter form still pick
their input type from the value (#3308), with no toggle.

## Tests

- `test_collectionRenderingHelpers.ts`: `isAllDayValue`, and `withAllDay` in
  both directions, idempotent, never inventing or destroying a value.
- `e2e/tests/collection-datetime-all-day.spec.ts`: toggling an existing timed
  value, a new record ticked before a date is picked, and saving after ticking
  sends the bare date.
