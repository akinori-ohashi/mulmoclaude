// Unit tests for the caller-supplied event span (#3240).
//
// Calendar expresses an all-day event as a bare `date` on both ends and a timed
// one as an RFC3339 `dateTime` on both ends, and answers an opaque 400 for
// anything else — a mix, or an all-day `end` that is not after its `start`.
// Every write surface (the `google` tool, the remote-host channel) routes its
// two strings through this, so the rule is stated once and the surfaces cannot
// drift apart.
//
// The all-day `end` is EXCLUSIVE and is passed through untouched. That is the
// property most worth pinning: `toEventSummary` reports Google's own end and
// `toGoogleEventTime` round-trips it, so a conversion here would shorten every
// all-day event by a day on each read-modify-write.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCalendarDateOnly,
  resolvePartialSpanInput,
  resolveSpanInput,
  toEventTimeInput,
  ALL_DAY_END_HINT,
  EVENT_TIME_HINT,
  LONE_ALL_DAY_HINT,
  MIXED_SPAN_HINT,
} from "@mulmoclaude/core/google";

describe("isCalendarDateOnly", () => {
  it("accepts a real calendar day", () => {
    assert.equal(isCalendarDateOnly("2026-07-17"), true);
    assert.equal(isCalendarDateOnly("2028-02-29"), true);
  });

  it("rejects a day that does not exist", () => {
    assert.equal(isCalendarDateOnly("2026-02-30"), false);
    assert.equal(isCalendarDateOnly("2026-13-01"), false);
    assert.equal(isCalendarDateOnly("2026-00-10"), false);
  });

  it("rejects anything carrying a clock", () => {
    assert.equal(isCalendarDateOnly("2026-07-17T00:00"), false);
    assert.equal(isCalendarDateOnly("2026-07-17T09:00:00+09:00"), false);
  });

  it("rejects surrounding whitespace, which would reach Google verbatim", () => {
    assert.equal(isCalendarDateOnly(" 2026-07-17"), false);
    assert.equal(isCalendarDateOnly("2026-07-17 "), false);
  });
});

describe("toEventTimeInput", () => {
  it("reads a bare date as all-day", () => {
    assert.deepEqual(toEventTimeInput("2026-07-17"), { date: "2026-07-17" });
  });

  it("reads an offset date-time as timed, verbatim", () => {
    assert.deepEqual(toEventTimeInput("2026-07-17T09:00:00+09:00"), { dateTime: "2026-07-17T09:00:00+09:00" });
    assert.deepEqual(toEventTimeInput("2026-07-17T00:00:00Z"), { dateTime: "2026-07-17T00:00:00Z" });
  });

  it("refuses an offset-less date-time — Google answers an opaque 400 for it", () => {
    assert.equal(toEventTimeInput("2026-07-17T09:00:00"), null);
  });

  it("refuses free text", () => {
    assert.equal(toEventTimeInput("next tuesday"), null);
    assert.equal(toEventTimeInput(""), null);
  });
});

describe("resolveSpanInput — a timed span", () => {
  it("passes both ends through as date-times", () => {
    const resolved = resolveSpanInput("2026-07-17T09:00:00+09:00", "2026-07-17T10:00:00+09:00");
    assert.deepEqual(resolved, {
      ok: true,
      span: { start: { dateTime: "2026-07-17T09:00:00+09:00" }, end: { dateTime: "2026-07-17T10:00:00+09:00" } },
    });
  });

  it("does not police the ordering — the two offsets decide it, and Google says so clearly", () => {
    const resolved = resolveSpanInput("2026-07-17T10:00:00+09:00", "2026-07-17T09:00:00+09:00");
    assert.equal(resolved.ok, true);
  });

  it("names the end that is neither shape", () => {
    const resolved = resolveSpanInput("2026-07-17T09:00:00+09:00", "tomorrow");
    assert.deepEqual(resolved, { ok: false, reason: `end ${EVENT_TIME_HINT}` });
  });
});

describe("resolveSpanInput — an all-day span", () => {
  it("passes both ends through as dates", () => {
    const resolved = resolveSpanInput("2026-07-17", "2026-07-18");
    assert.deepEqual(resolved, { ok: true, span: { start: { date: "2026-07-17" }, end: { date: "2026-07-18" } } });
  });

  it("keeps the EXCLUSIVE end untouched — a multi-day span is not shortened", () => {
    const resolved = resolveSpanInput("2026-07-17", "2026-07-20");
    assert.equal(resolved.ok && "date" in resolved.span.end && resolved.span.end.date, "2026-07-20");
  });

  it("refuses an end equal to the start, the natural reading of `all day on the 17th`", () => {
    assert.deepEqual(resolveSpanInput("2026-07-17", "2026-07-17"), { ok: false, reason: ALL_DAY_END_HINT });
  });

  it("refuses an end before the start", () => {
    assert.deepEqual(resolveSpanInput("2026-07-17", "2026-07-16"), { ok: false, reason: ALL_DAY_END_HINT });
  });

  it("compares across a month and a year boundary", () => {
    assert.equal(resolveSpanInput("2026-07-31", "2026-08-01").ok, true);
    assert.equal(resolveSpanInput("2026-12-31", "2027-01-01").ok, true);
    assert.equal(resolveSpanInput("2027-01-01", "2026-12-31").ok, false);
  });
});

describe("resolveSpanInput — the two ends must agree", () => {
  it("refuses an all-day start with a timed end", () => {
    assert.deepEqual(resolveSpanInput("2026-07-17", "2026-07-17T10:00:00+09:00"), { ok: false, reason: MIXED_SPAN_HINT });
  });

  it("refuses a timed start with an all-day end", () => {
    assert.deepEqual(resolveSpanInput("2026-07-17T09:00:00+09:00", "2026-07-18"), { ok: false, reason: MIXED_SPAN_HINT });
  });
});

describe("resolvePartialSpanInput — an edit", () => {
  it("is an empty span when neither end is given", () => {
    assert.deepEqual(resolvePartialSpanInput(undefined, undefined), { ok: true, times: {} });
  });

  it("moves one end of a timed event", () => {
    assert.deepEqual(resolvePartialSpanInput("2026-07-17T09:30:00+09:00", undefined), {
      ok: true,
      times: { start: { dateTime: "2026-07-17T09:30:00+09:00" } },
    });
    assert.deepEqual(resolvePartialSpanInput(undefined, "2026-07-17T11:00:00+09:00"), {
      ok: true,
      times: { end: { dateTime: "2026-07-17T11:00:00+09:00" } },
    });
  });

  it("refuses a lone all-day end — the stored event's kind is not knowable here", () => {
    assert.deepEqual(resolvePartialSpanInput("2026-07-17", undefined), { ok: false, reason: LONE_ALL_DAY_HINT });
    assert.deepEqual(resolvePartialSpanInput(undefined, "2026-07-18"), { ok: false, reason: LONE_ALL_DAY_HINT });
  });

  it("applies the full span rules when both ends are given", () => {
    assert.deepEqual(resolvePartialSpanInput("2026-07-17", "2026-07-18"), {
      ok: true,
      times: { start: { date: "2026-07-17" }, end: { date: "2026-07-18" } },
    });
    assert.deepEqual(resolvePartialSpanInput("2026-07-17", "2026-07-17"), { ok: false, reason: ALL_DAY_END_HINT });
    assert.deepEqual(resolvePartialSpanInput("2026-07-17", "2026-07-17T10:00:00+09:00"), { ok: false, reason: MIXED_SPAN_HINT });
  });

  it("names the offending end", () => {
    assert.deepEqual(resolvePartialSpanInput("nope", undefined), { ok: false, reason: `start ${EVENT_TIME_HINT}` });
    assert.deepEqual(resolvePartialSpanInput(undefined, "nope"), { ok: false, reason: `end ${EVENT_TIME_HINT}` });
  });
});
