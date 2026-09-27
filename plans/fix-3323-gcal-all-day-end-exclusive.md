# fix: a Google mirror's all-day event renders one day too long (#3323)

## Problem

The calendar spans a record over `[calendarField, calendarEndField]` inclusive.
Google's all-day `end` is exclusive (a one-day event on the 17th ends on the
18th), so a mirrored or locally created all-day event also covers the next day.

## Decision (agreed on the issue)

Display only, Google-synced collections only. A plain collection may mean its
end date inclusively, and stored values stay as they are (the push sends them
back verbatim).

- `recordSpan` / `bucketRecords` take `SpanOptions { endExclusive }`.
- `withExclusiveEnd`: if the end is a bare date or `00:00` of a later day, the
  span stops on the day before. A `00:00` end becomes `endMin = 24:00`. An end
  with any other clock, or on the start day, is unchanged.
- `spanOptionsFor(schema, endField)`: `endExclusive` only when
  `googleCalendar.map[endField] === "end"`.
- The month view and the day view both pass `spanOptionsFor(...)`.
- `helps/google-calendar-collection.md` says the calendar now reads the end
  this way, and that the stored value stays exclusive.

## Tests

- `test_calendarGrid.ts`: bare-date and `T00:00` ends, a multi-day span, an
  end past midnight, a same-day end, an inclusive default, `daySlice` on the
  day, and `spanOptionsFor`.
- `e2e/tests/collection-calendar.spec.ts`: a Google mirror's all-day event
  shows on its day only, and the same dates in a plain collection span both
  days.
