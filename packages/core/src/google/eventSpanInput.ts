// A caller-supplied event span → the pair of times the Calendar body carries.
//
// Every write surface (the `google` tool, the remote-host command channel)
// takes a span as two strings. Calendar accepts two shapes and rejects the mix
// with an opaque 400, so the rule lives here once rather than in each surface:
// a timed event is RFC3339 WITH an offset on both ends, an all-day event is a
// bare `YYYY-MM-DD` on both ends.
//
// Google's all-day `end` is EXCLUSIVE — a single day on the 17th ends on the
// 18th. It is passed through untouched: `toEventSummary` reports Google's raw
// value and `pushDateTime.allDayFrom` round-trips it, so converting an
// inclusive end on the way in would shorten the event by a day on every
// read-modify-write. An end that is not after the start is reported here, where
// the caller can be told the rule, instead of at Google.
//
// Pure: no I/O, no clock, no locale.
import { parseIsoDate } from "../collection/core/calendarGrid.js";
import type { CalendarEventTime } from "./calendar.js";
import { isIsoDateTimeWithOffset } from "./datetime.js";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a bare calendar day — the all-day spelling of an event
 *  time, and the one shape `isIsoDateTimeWithOffset` is built to refuse.
 *
 *  Realness comes from the parser the record lint, the calendar grid and the
 *  push already share, so every surface agrees that `2026-02-30` is not a day.
 *  The regex runs first because that parser trims, and a value with whitespace
 *  around it would validate here and then reach Google verbatim. */
export const isCalendarDateOnly = (value: string): boolean => DATE_ONLY_RE.test(value) && parseIsoDate(value) !== null;

/** One end of a span, or null when it is neither shape Calendar accepts. */
export const toEventTimeInput = (value: string): CalendarEventTime | null => {
  if (isCalendarDateOnly(value)) return { date: value };
  return isIsoDateTimeWithOffset(value) ? { dateTime: value } : null;
};

/** The rule every surface states for a value that is neither shape. Shared so
 *  the tool, the remote host and their tests cannot drift apart. */
export const EVENT_TIME_HINT =
  "must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00), or a date for an all-day event (e.g. 2026-07-17)";

/** The same rule with the offending key named, for a surface whose error text
 *  carries no path of its own. */
export const eventTimeHint = (key: string): string => `${key} ${EVENT_TIME_HINT}`;

/** All-day `end` is exclusive, so a one-day event ends on the NEXT day. Spelled
 *  out because the natural reading of "all day on the 17th" is `end` = the
 *  17th, which Calendar refuses. */
export const ALL_DAY_END_HINT = "an all-day `end` is EXCLUSIVE — it is the day AFTER the last day, so a single day on 2026-07-17 needs end 2026-07-18";

export const MIXED_SPAN_HINT = "start and end must both be date-times with an offset, or both be dates for an all-day event — not one of each";

/** A lone all-day end cannot be patched: the stored event's kind is unknown
 *  here, and giving one end of a timed event a `date` makes an event Calendar
 *  rejects — with a message that names neither end. Both together are
 *  unambiguous, so that is what the caller is asked for. */
export const LONE_ALL_DAY_HINT = `pass BOTH start and end to move an all-day event — ${ALL_DAY_END_HINT}`;

const isAllDay = (time: CalendarEventTime): time is { date: string } => "date" in time;

export interface SpanTimes {
  start: CalendarEventTime;
  end: CalendarEventTime;
}
export type SpanResult = { ok: true; span: SpanTimes } | { ok: false; reason: string };

/** Both ends of a create, validated together.
 *
 *  Only the all-day ordering is checked: a timed span's ordering depends on the
 *  two offsets, which Calendar resolves and reports on clearly, while an all-day
 *  `end <= start` comes back as an opaque 400. Lexicographic comparison is exact
 *  for `YYYY-MM-DD` — fixed-width, most significant part first. */
export function resolveSpanInput(start: string, end: string): SpanResult {
  const startTime = toEventTimeInput(start);
  if (startTime === null) return { ok: false, reason: eventTimeHint("start") };
  const endTime = toEventTimeInput(end);
  if (endTime === null) return { ok: false, reason: eventTimeHint("end") };
  if (isAllDay(startTime) !== isAllDay(endTime)) return { ok: false, reason: MIXED_SPAN_HINT };
  if (isAllDay(startTime) && isAllDay(endTime) && endTime.date <= startTime.date) return { ok: false, reason: ALL_DAY_END_HINT };
  return { ok: true, span: { start: startTime, end: endTime } };
}

export interface PartialSpanTimes {
  start?: CalendarEventTime;
  end?: CalendarEventTime;
}
export type PartialSpanResult = { ok: true; times: PartialSpanTimes } | { ok: false; reason: string };

/** One end of an EDIT, where the other end is absent. */
function resolveLoneEnd(key: "start" | "end", value: string): PartialSpanResult {
  const time = toEventTimeInput(value);
  if (time === null) return { ok: false, reason: eventTimeHint(key) };
  if (isAllDay(time)) return { ok: false, reason: LONE_ALL_DAY_HINT };
  return { ok: true, times: { [key]: time } };
}

/** The span of an EDIT, where either end may be absent. */
export function resolvePartialSpanInput(start: string | undefined, end: string | undefined): PartialSpanResult {
  if (start !== undefined && end !== undefined) {
    const resolved = resolveSpanInput(start, end);
    return resolved.ok ? { ok: true, times: resolved.span } : resolved;
  }
  if (start !== undefined) return resolveLoneEnd("start", start);
  if (end !== undefined) return resolveLoneEnd("end", end);
  return { ok: true, times: {} };
}
