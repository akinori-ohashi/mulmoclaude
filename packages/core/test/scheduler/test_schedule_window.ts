import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";
import {
  toLibrarySchedule,
  isScheduleDueAt,
  latestWindowAtOrBefore,
  unfireableScheduleReason,
  windowToIso,
  type TaskSchedule,
} from "../../src/scheduler/schedule-window.ts";

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const SWEEP_START_MS = Date.UTC(2026, 7, 2); // Sunday 2026-08-02T00:00:00Z
const SWEEP_DAYS = 21;

/** Every instant in a `SWEEP_DAYS` window at which the schedule fires, walking
 *  one tick at a time the way the engine does. */
function sweepFireTimes(schedule: TaskSchedule, tickMs = ONE_MINUTE_MS): string[] {
  const fired: string[] = [];
  const ticks = (SWEEP_DAYS * ONE_DAY_MS) / tickMs;
  for (let index = 0; index < ticks; index++) {
    const nowMs = SWEEP_START_MS + index * tickMs;
    if (isScheduleDueAt(schedule, nowMs, tickMs)) fired.push(new Date(nowMs).toISOString());
  }
  return fired;
}

const gapsMs = (isoTimes: string[]): number[] => isoTimes.slice(1).map((iso, index) => Date.parse(iso) - Date.parse(isoTimes[index] ?? iso));

test("toLibrarySchedule converts ms to sec without rounding away the remainder", () => {
  assert.deepEqual(toLibrarySchedule({ type: SCHEDULE_TYPES.interval, intervalMs: 168 * ONE_HOUR_MS }), {
    type: SCHEDULE_TYPES.interval,
    intervalSec: 604_800,
  });
  assert.deepEqual(toLibrarySchedule({ type: SCHEDULE_TYPES.interval, intervalMs: 1500 }), { type: SCHEDULE_TYPES.interval, intervalSec: 1.5 });
  assert.deepEqual(toLibrarySchedule({ type: SCHEDULE_TYPES.daily, time: "19:00" }), { type: SCHEDULE_TYPES.daily, time: "19:00" });
});

// The bug: `msSinceMidnight % intervalMs` can only be 0 at 00:00 once the
// interval exceeds a day, so every long interval collapsed to "daily" (#2937).
test("an interval longer than 24h keeps its period instead of firing daily", () => {
  const weekly = sweepFireTimes({ type: SCHEDULE_TYPES.interval, intervalMs: 168 * ONE_HOUR_MS });
  assert.deepEqual(weekly, ["2026-08-06T00:00:00.000Z", "2026-08-13T00:00:00.000Z", "2026-08-20T00:00:00.000Z"]);

  const everyOtherDay = sweepFireTimes({ type: SCHEDULE_TYPES.interval, intervalMs: 48 * ONE_HOUR_MS });
  assert.equal(everyOtherDay.length, 10);
  assert.deepEqual(new Set(gapsMs(everyOtherDay)), new Set([48 * ONE_HOUR_MS]));
});

// The same defect at a smaller scale: the phase reset at midnight shortened the
// last window of every interval that does not divide 24h.
test("an interval that does not divide 24h does not reset its phase at midnight", () => {
  const everySevenHours = sweepFireTimes({ type: SCHEDULE_TYPES.interval, intervalMs: 7 * ONE_HOUR_MS });
  assert.deepEqual(new Set(gapsMs(everySevenHours)), new Set([7 * ONE_HOUR_MS]));
  assert.deepEqual(everySevenHours.slice(0, 4), [
    "2026-08-02T05:00:00.000Z",
    "2026-08-02T12:00:00.000Z",
    "2026-08-02T19:00:00.000Z",
    "2026-08-03T02:00:00.000Z",
  ]);
});

test("intervals that divide 24h fire at the same times as before", () => {
  const everySixHours = sweepFireTimes({ type: SCHEDULE_TYPES.interval, intervalMs: 6 * ONE_HOUR_MS });
  assert.equal(everySixHours.length, SWEEP_DAYS * 4);
  assert.deepEqual(everySixHours.slice(0, 4), ["2026-08-02T00:00:00.000Z", "2026-08-02T06:00:00.000Z", "2026-08-02T12:00:00.000Z", "2026-08-02T18:00:00.000Z"]);
  assert.deepEqual(sweepFireTimes({ type: SCHEDULE_TYPES.interval, intervalMs: 30 * ONE_MINUTE_MS }).length, SWEEP_DAYS * 48);
});

// Property harvested from the differential harness that verified this change:
// whatever the interval, consecutive firings are exactly one interval apart.
test("consecutive firings are exactly one interval apart, for every interval", () => {
  const intervalsMs = [
    ONE_MINUTE_MS,
    30 * ONE_MINUTE_MS,
    50 * ONE_MINUTE_MS,
    ONE_HOUR_MS,
    6 * ONE_HOUR_MS,
    7 * ONE_HOUR_MS,
    24 * ONE_HOUR_MS,
    48 * ONE_HOUR_MS,
    168 * ONE_HOUR_MS,
  ];
  intervalsMs.forEach((intervalMs) => {
    const fired = sweepFireTimes({ type: SCHEDULE_TYPES.interval, intervalMs });
    assert.ok(fired.length >= 2, `interval ${intervalMs}ms never fired twice in ${SWEEP_DAYS} days`);
    assert.deepEqual(new Set(gapsMs(fired)), new Set([intervalMs]), `interval ${intervalMs}ms has uneven gaps`);
  });
});

test("a daily schedule still fires once a day at its stated time", () => {
  const fired = sweepFireTimes({ type: SCHEDULE_TYPES.daily, time: "19:00" });
  assert.equal(fired.length, SWEEP_DAYS);
  assert.deepEqual(new Set(gapsMs(fired)), new Set([ONE_DAY_MS]));
  assert.equal(fired[0], "2026-08-02T19:00:00.000Z");
});

const UNFIREABLE_SCHEDULES: TaskSchedule[] = [
  { type: SCHEDULE_TYPES.daily, time: "not a time" },
  { type: SCHEDULE_TYPES.daily, time: "" },
  // Out of range, not merely odd: a library window for these lands on the NEXT
  // day's midnight (`"24:00"`, `"23:60"`) or an hour before it (`"-1:00"`),
  // which would turn an inert typo into a firing task.
  { type: SCHEDULE_TYPES.daily, time: "24:00" },
  { type: SCHEDULE_TYPES.daily, time: "23:60" },
  { type: SCHEDULE_TYPES.daily, time: "25:00" },
  { type: SCHEDULE_TYPES.daily, time: "-1:00" },
  { type: SCHEDULE_TYPES.interval, intervalMs: 0 },
  { type: SCHEDULE_TYPES.interval, intervalMs: -ONE_HOUR_MS },
  { type: SCHEDULE_TYPES.interval, intervalMs: Number.NaN },
  { type: SCHEDULE_TYPES.interval, intervalMs: Number.POSITIVE_INFINITY },
];

test("a schedule that can never fire is inert, and says which field is wrong", () => {
  UNFIREABLE_SCHEDULES.forEach((schedule) => {
    assert.equal(sweepFireTimes(schedule).length, 0, `${JSON.stringify(schedule)} fired`);
    assert.equal(latestWindowAtOrBefore(schedule, SWEEP_START_MS), null, `${JSON.stringify(schedule)} reported a window`);
    assert.notEqual(unfireableScheduleReason(schedule), null, `${JSON.stringify(schedule)} was not reported`);
  });
  assert.deepEqual(unfireableScheduleReason({ type: SCHEDULE_TYPES.interval, intervalMs: 0 }), { field: "intervalMs", value: "0" });
  assert.deepEqual(unfireableScheduleReason({ type: SCHEDULE_TYPES.daily, time: "xx:yy" }), { field: "time", value: "xx:yy" });
  assert.equal(unfireableScheduleReason({ type: SCHEDULE_TYPES.daily, time: "07:30" }), null);
  assert.equal(unfireableScheduleReason({ type: SCHEDULE_TYPES.daily, time: "23:59" }), null, "the last minute of the day is a real time");
  assert.equal(unfireableScheduleReason({ type: SCHEDULE_TYPES.interval, intervalMs: ONE_HOUR_MS }), null);
});

// What a run persists as `lastRunAt`. Asking `nextWindowAfter` from "now minus
// one period" answered the PREVIOUS window when the clock sat exactly on a
// boundary, and a daily schedule read one second late answered TOMORROW —
// which the caller then discarded for the wall clock. Raised by CodeRabbit.
test("the window a run belongs to is the latest one at or before the tick", () => {
  const weekly: TaskSchedule = { type: SCHEDULE_TYPES.interval, intervalMs: 168 * ONE_HOUR_MS };
  const windowMs = Date.UTC(2026, 7, 6); // an exact multiple of 168h from the epoch
  assert.equal(latestWindowAtOrBefore(weekly, windowMs), windowMs, "a tick exactly on the window must report that window");
  assert.equal(latestWindowAtOrBefore(weekly, windowMs + 250), windowMs, "a tick just after it belongs to the same window");
  assert.equal(latestWindowAtOrBefore(weekly, windowMs - 1), windowMs - 168 * ONE_HOUR_MS, "a tick just before it belongs to the previous one");

  const daily: TaskSchedule = { type: SCHEDULE_TYPES.daily, time: "19:00" };
  const dailyWindowMs = Date.UTC(2026, 7, 2, 19, 0, 0);
  assert.equal(latestWindowAtOrBefore(daily, dailyWindowMs), dailyWindowMs);
  assert.equal(
    latestWindowAtOrBefore(daily, dailyWindowMs + ONE_SECOND_MS),
    dailyWindowMs,
    "a run a second late still belongs to 19:00, not to the wall clock",
  );
  assert.equal(latestWindowAtOrBefore(daily, dailyWindowMs - ONE_SECOND_MS), dailyWindowMs - ONE_DAY_MS, "before today's window, the last one is yesterday's");
});

// An interval large enough pushes its next window past the end of `Date`. The
// arithmetic stays finite, so only the serialization notices — with a throw,
// inside the state writer, which used to swallow the entire run record.
// Raised by CodeRabbit.
test("a window that is not a date serializes to null instead of throwing", () => {
  assert.equal(windowToIso(Date.UTC(2026, 7, 6)), "2026-08-06T00:00:00.000Z");
  assert.equal(windowToIso(null), null);
  assert.equal(windowToIso(Number.NaN), null);
  assert.equal(windowToIso(1e16), null, "past the end of Date");
  assert.equal(windowToIso(-1e16), null);
  assert.equal(windowToIso(8.64e15), "+275760-09-13T00:00:00.000Z", "the last representable instant is still a date");

  // The whole path an oversized interval takes: still finite, still not a date.
  const absurd: TaskSchedule = { type: SCHEDULE_TYPES.interval, intervalMs: 1e16 };
  assert.equal(unfireableScheduleReason(absurd), null, "it is a usable number — only the window is out of range");
  assert.equal(windowToIso(latestWindowAtOrBefore(absurd, Date.UTC(2026, 7, 6))), "1970-01-01T00:00:00.000Z");
});

test("a tick that lands mid-window still fires exactly once per window", () => {
  const schedule: TaskSchedule = { type: SCHEDULE_TYPES.interval, intervalMs: ONE_HOUR_MS };
  // Ticks drift off the boundary (setInterval jitter): the window must be
  // caught by the tick that contains it, and only by that one.
  const offsetMs = 137;
  const fired: number[] = [];
  for (let index = 0; index < 24 * 60; index++) {
    const nowMs = SWEEP_START_MS + offsetMs + index * ONE_MINUTE_MS;
    if (isScheduleDueAt(schedule, nowMs, ONE_MINUTE_MS)) fired.push(nowMs);
  }
  assert.equal(fired.length, 24);
  const offsetsIntoTheHourMs = fired.map((firedMs) => (firedMs - SWEEP_START_MS - offsetMs) % ONE_HOUR_MS);
  assert.deepEqual(new Set(offsetsIntoTheHourMs), new Set([0]));
});
