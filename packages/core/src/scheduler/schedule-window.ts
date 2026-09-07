// One definition of "when does this schedule fire". The host expresses
// intervals in milliseconds and the library (@receptron/task-scheduler) in
// seconds, so every place that answers "is it due now?", "when is the next
// run?" or "which windows were missed?" has to cross that boundary. Doing it
// twice is what let the tick engine drift away from `nextWindowAfter`: its own
// interval check counted from UTC midnight, so anything longer than a day
// collapsed to "every day at 00:00" while the UI kept showing the real,
// epoch-anchored next run (#2937).

import { SCHEDULE_TYPES, isDueAt, nextWindowAfter, parseTimeToMs, type TaskSchedule as LibrarySchedule } from "@receptron/task-scheduler";

const ONE_SECOND_MS = 1000;
const ONE_DAY_MS = 24 * 60 * 60 * ONE_SECOND_MS;

/** A schedule as the host states it: intervals in milliseconds, or a daily
 *  `HH:MM` UTC time. */
export type TaskSchedule = { type: typeof SCHEDULE_TYPES.interval; intervalMs: number } | { type: typeof SCHEDULE_TYPES.daily; time: string };

/** An interval this engine can never turn into a window. Zero divides by zero
 *  inside the library's `Math.ceil(afterMs / intervalMs)`; a negative or
 *  non-finite one poisons the arithmetic with NaN, which compares false
 *  everywhere and so hides itself. */
function isUsableInterval(intervalMs: number): boolean {
  return Number.isFinite(intervalMs) && intervalMs > 0;
}

/** Milliseconds past UTC midnight for a daily `HH:MM`, or null when the string
 *  does not name a time of day. Out-of-range values are rejected, not clamped
 *  and not wrapped: `"24:00"` would otherwise land on the NEXT day's midnight
 *  and `"-1:00"` on an hour before it, so a typo that used to be inert would
 *  start firing — at 00:00 daily, or 61 times a day. */
function dailyOffsetMs(time: string): number | null {
  const offsetMs = parseTimeToMs(time);
  return Number.isFinite(offsetMs) && offsetMs >= 0 && offsetMs < ONE_DAY_MS ? offsetMs : null;
}

/** Convert to the library's schedule shape. Milliseconds are divided, never
 *  rounded: rounding a sub-second interval to `intervalSec: 0` is what made
 *  `nextWindowAfter` answer NaN and `new Date(NaN).toISOString()` throw. */
export function toLibrarySchedule(schedule: TaskSchedule): LibrarySchedule {
  if (schedule.type === SCHEDULE_TYPES.interval) {
    return { type: SCHEDULE_TYPES.interval, intervalSec: schedule.intervalMs / ONE_SECOND_MS };
  }
  return { type: SCHEDULE_TYPES.daily, time: schedule.time };
}

/** True when a scheduled window falls inside the tick ending at `nowMs`.
 *  Windows are anchored to the epoch, not to the current UTC day, so an
 *  interval longer than 24h keeps its real period. */
export function isScheduleDueAt(schedule: TaskSchedule, nowMs: number, tickMs: number): boolean {
  if (unfireableScheduleReason(schedule) !== null) return false;
  return isDueAt(toLibrarySchedule(schedule), nowMs, tickMs);
}

/** The furthest instant `Date` can represent. A window past it is finite
 *  arithmetic but not a date, and `toISOString()` answers that with a throw —
 *  which, inside the state writer, silently loses the whole run record. */
const MAX_DATE_MS = 8.64e15;

/** A window as an ISO timestamp, or null when the number is not a date. */
export function windowToIso(windowMs: number | null): string | null {
  if (windowMs === null || !Number.isFinite(windowMs) || Math.abs(windowMs) > MAX_DATE_MS) return null;
  return new Date(windowMs).toISOString();
}

/** The most recent window at or before `nowMs`, or null when the schedule has
 *  none. `nextWindowAfter` only ever looks FORWARD, so asking it from
 *  `nowMs - one period` answers the previous window whenever `nowMs` sits
 *  exactly on a boundary, and a daily schedule read after its minute answers
 *  TOMORROW. Both schedule kinds have a fixed period, so stepping one period
 *  back off the next window is exact. */
export function latestWindowAtOrBefore(schedule: TaskSchedule, nowMs: number): number | null {
  if (unfireableScheduleReason(schedule) !== null) return null;
  const next = nextWindowAfter(toLibrarySchedule(schedule), nowMs);
  if (next === null || !Number.isFinite(next)) return null;
  if (next <= nowMs) return next;
  const periodMs = schedule.type === SCHEDULE_TYPES.interval ? schedule.intervalMs : ONE_DAY_MS;
  return next - periodMs;
}

/** Name the field that makes a schedule unfireable, or null when it is fine.
 *  Returns the offending value (not a boolean) so the caller can put it in the
 *  log — a task that silently never runs leaves no evidence to start from
 *  (#2765). */
export function unfireableScheduleReason(schedule: TaskSchedule): { field: string; value: string } | null {
  if (schedule.type === SCHEDULE_TYPES.interval) {
    return isUsableInterval(schedule.intervalMs) ? null : { field: "intervalMs", value: String(schedule.intervalMs) };
  }
  return dailyOffsetMs(schedule.time) !== null ? null : { field: "time", value: schedule.time };
}
