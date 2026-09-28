// Unit tests for the `google` tool arg schemas — validation only, no
// network and no engine calls.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isIsoDateTimeWithOffset } from "@mulmoclaude/core/google";

import { GoogleArgs } from "../src/args";

describe("isIsoDateTimeWithOffset", () => {
  const accepted = [
    "2026-07-17T09:00:00+09:00",
    "2026-07-17T09:00:00Z",
    "2026-07-17T09:00:00.000Z",
    "2026-07-17T23:59:59.5-05:00",
    "2026-07-17T09:00:00+23:59",
  ];
  for (const value of accepted) {
    it(`accepts ${value}`, () => {
      assert.equal(isIsoDateTimeWithOffset(value), true);
    });
  }

  const rejected = [
    "2026-07-17",
    "2026-07-17T09:00:00",
    "not-a-date",
    "2026-13-01T09:00:00Z",
    "2026-02-31T09:00:00Z",
    "2026-07-17T24:00:00Z",
    "2026-07-17T09:00:00+24:00",
    "2026-07-17T09:00:00+14:61",
    "2026-07-17T09:00Z",
    "",
  ];
  for (const value of rejected) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      assert.equal(isIsoDateTimeWithOffset(value), false);
    });
  }
});

describe("GoogleArgs", () => {
  it("parses a status request", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "status" }), { kind: "status" });
  });

  it("parses calendarListEvents with defaults omitted", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "calendarListEvents" }), { kind: "calendarListEvents" });
  });

  it("rejects an out-of-range maxResults", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", maxResults: 500 }));
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", maxResults: 0 }));
  });

  it("rejects a non-integer maxResults", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", maxResults: 2.5 }));
  });

  it("parses calendarListCalendars and calendarColors", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "calendarListCalendars" }), { kind: "calendarListCalendars" });
    assert.deepEqual(GoogleArgs.parse({ kind: "calendarColors" }), { kind: "calendarColors" });
  });

  it("parses calendarListEvents targeting a non-primary calendar", () => {
    const args = GoogleArgs.parse({ kind: "calendarListEvents", calendarId: "team@group.calendar.google.com" });
    assert.equal(args.kind === "calendarListEvents" && args.calendarId, "team@group.calendar.google.com");
  });

  it("rejects an empty or whitespace calendarId (would build /calendars//events)", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", calendarId: "" }));
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", calendarId: "   " }));
    const create = { kind: "calendarCreateEvent", summary: "x", start: "2026-07-17T09:00:00Z", end: "2026-07-17T10:00:00Z" };
    assert.throws(() => GoogleArgs.parse({ ...create, calendarId: "" }));
  });

  it("trims calendarId whitespace", () => {
    const args = GoogleArgs.parse({ kind: "calendarListEvents", calendarId: "  team@group.calendar.google.com  " });
    assert.equal(args.kind === "calendarListEvents" && args.calendarId, "team@group.calendar.google.com");
  });

  it("parses a full calendarCreateEvent", () => {
    const args = GoogleArgs.parse({
      kind: "calendarCreateEvent",
      summary: "Standup",
      start: "2026-07-17T09:00:00+09:00",
      end: "2026-07-17T09:15:00+09:00",
      description: "daily",
      calendarId: "team@group.calendar.google.com",
      colorId: "7",
    });
    assert.equal(args.kind, "calendarCreateEvent");
    assert.equal(args.kind === "calendarCreateEvent" && args.colorId, "7");
  });

  it("parses an all-day calendarCreateEvent — bare dates on both ends", () => {
    const args = GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "Holiday", start: "2026-07-17", end: "2026-07-18" });
    assert.equal(args.kind === "calendarCreateEvent" && args.start, "2026-07-17");
    assert.equal(args.kind === "calendarCreateEvent" && args.end, "2026-07-18");
  });

  it("rejects an all-day end equal to its start — the exclusive-end trap", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "x", start: "2026-07-17", end: "2026-07-17" }), /EXCLUSIVE/);
  });

  it("rejects one end of each kind, either way round", () => {
    assert.throws(
      () => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "x", start: "2026-07-17", end: "2026-07-17T10:00:00+09:00" }),
      /not one of each/,
    );
    assert.throws(
      () => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "x", start: "2026-07-17T09:00:00+09:00", end: "2026-07-18" }),
      /not one of each/,
    );
  });

  it("still rejects an offset-less date-time — Google answers an opaque 400 for it", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "x", start: "2026-07-17T09:00:00", end: "2026-07-17T10:00:00" }));
  });

  it("still rejects an impossible day", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "x", start: "2026-02-30", end: "2026-03-01" }));
  });

  it("rejects calendarCreateEvent with an empty summary", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "", start: "2026-07-17T09:00:00Z", end: "2026-07-17T10:00:00Z" }));
  });

  it("rejects an unknown kind", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "gmailSend" }));
  });
});

describe("GoogleArgs — tasks", () => {
  it("parses taskListsList", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "taskListsList" }), { kind: "taskListsList" });
  });

  it("parses tasksList with defaults omitted", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "tasksList" }), { kind: "tasksList" });
  });

  it("parses tasksList with every option", () => {
    const args = GoogleArgs.parse({ kind: "tasksList", taskListId: "abc", maxResults: 5, showCompleted: true });
    assert.equal(args.kind, "tasksList");
  });

  it("rejects tasksList with an out-of-range maxResults", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksList", maxResults: 500 }));
  });

  it("rejects a non-boolean showCompleted", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksList", showCompleted: "yes" }));
  });

  it("parses tasksCreate with just a title", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "tasksCreate", title: "Buy milk" }), { kind: "tasksCreate", title: "Buy milk" });
  });

  it("rejects tasksCreate with an empty title", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksCreate", title: "" }));
  });

  it("rejects tasksCreate with a date-only due", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksCreate", title: "x", due: "2026-07-18" }));
  });

  it("accepts tasksCreate with an offset-bearing due", () => {
    const args = GoogleArgs.parse({ kind: "tasksCreate", title: "x", due: "2026-07-18T09:00:00+09:00" });
    assert.equal(args.kind, "tasksCreate");
  });

  it("rejects tasksComplete without a taskId", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksComplete" }));
  });

  // A blank taskListId used to reach core as "", which built `/lists//tasks`
  // instead of falling back to the user's default list (Codex, PR #2572).
  // Every tasks kind decides this, so every tasks kind is checked.
  const listBearing = [
    { kind: "tasksList" },
    { kind: "tasksCreate", title: "x" },
    { kind: "tasksUpdate", taskId: "t1", title: "x" },
    { kind: "tasksComplete", taskId: "t1" },
    { kind: "tasksUncomplete", taskId: "t1" },
    { kind: "tasksDelete", taskId: "t1" },
  ];
  for (const base of listBearing) {
    it(`rejects a blank taskListId on ${base.kind}`, () => {
      assert.throws(() => GoogleArgs.parse({ ...base, taskListId: "" }));
      assert.throws(() => GoogleArgs.parse({ ...base, taskListId: "   " }));
    });

    it(`trims taskListId whitespace on ${base.kind}`, () => {
      const parsed = GoogleArgs.parse({ ...base, taskListId: "  MTIzNDU2  " });
      assert.equal("taskListId" in parsed && parsed.taskListId, "MTIzNDU2");
    });
  }
});

describe("GoogleArgs — calendar update / delete (#2569)", () => {
  const update = { kind: "calendarUpdateEvent", eventId: "e1" };

  it("parses an update that changes one field", () => {
    const args = GoogleArgs.parse({ ...update, summary: "Renamed" });
    assert.equal(args.kind, "calendarUpdateEvent");
  });

  // A PATCH with no fields answers 200 on an unchanged event, so the LLM would
  // report a successful edit that never happened.
  it("rejects an update that changes nothing", () => {
    assert.throws(() => GoogleArgs.parse(update), /at least one field/);
  });

  it("rejects an update whose only field is calendarId — that targets, it does not edit", () => {
    assert.throws(() => GoogleArgs.parse({ ...update, calendarId: "team@group.calendar.google.com" }), /at least one field/);
  });

  // "" is a real edit (clear the body), so it must satisfy the guard that a
  // naive truthiness check would reject.
  it('accepts description: "" as the one change — it clears the body', () => {
    const args = GoogleArgs.parse({ ...update, description: "" });
    assert.equal(args.kind === "calendarUpdateEvent" && args.description, "");
  });

  it("rejects an empty eventId", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarUpdateEvent", eventId: "", summary: "x" }));
  });

  it("rejects a lone all-day end — whether the stored event is all-day is unknowable here", () => {
    assert.throws(() => GoogleArgs.parse({ ...update, start: "2026-07-17" }), /BOTH start and end/);
    assert.throws(() => GoogleArgs.parse({ ...update, end: "2026-07-18" }), /BOTH start and end/);
  });

  it("parses an all-day move when both ends are given", () => {
    const args = GoogleArgs.parse({ ...update, start: "2026-07-17", end: "2026-07-18" });
    assert.equal(args.kind === "calendarUpdateEvent" && args.start, "2026-07-17");
  });

  it("parses moving one end of a timed event", () => {
    const args = GoogleArgs.parse({ ...update, end: "2026-07-17T11:00:00+09:00" });
    assert.equal(args.kind === "calendarUpdateEvent" && args.end, "2026-07-17T11:00:00+09:00");
  });

  it("parses a delete", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "calendarDeleteEvent", eventId: "e1" }), { kind: "calendarDeleteEvent", eventId: "e1" });
  });

  it("rejects a delete without an eventId — it would target the collection URL", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarDeleteEvent" }));
    assert.throws(() => GoogleArgs.parse({ kind: "calendarDeleteEvent", eventId: "" }));
  });
});

describe("GoogleArgs — tasks update / delete (#2569)", () => {
  it("parses an update that changes one field", () => {
    const args = GoogleArgs.parse({ kind: "tasksUpdate", taskId: "t1", title: "Renamed" });
    assert.equal(args.kind, "tasksUpdate");
  });

  it("rejects an update that changes nothing", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksUpdate", taskId: "t1" }), /at least one field/);
  });

  it('accepts notes: "" as the one change — it clears them', () => {
    const args = GoogleArgs.parse({ kind: "tasksUpdate", taskId: "t1", notes: "" });
    assert.equal(args.kind === "tasksUpdate" && args.notes, "");
  });

  it("rejects a date-only due on update, same as create", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksUpdate", taskId: "t1", due: "2026-07-18" }));
  });

  it("parses tasksUncomplete", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "tasksUncomplete", taskId: "t1" }), { kind: "tasksUncomplete", taskId: "t1" });
  });

  it("rejects tasksUncomplete without a taskId", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksUncomplete" }));
  });

  // The un-complete path must not become a second way to edit fields — that is
  // the "two routes set the same state" drift #2572 deliberately avoided. The
  // schema is non-strict throughout (no `.strict()` anywhere in args.ts), so
  // the guarantee is that an edit field is STRIPPED, not that it throws: it
  // never reaches the engine either way. `tasksComplete` behaves identically.
  it("strips an edit field off tasksUncomplete so it cannot reach the engine", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "tasksUncomplete", taskId: "t1", title: "Renamed" }), { kind: "tasksUncomplete", taskId: "t1" });
  });

  it("parses a delete", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "tasksDelete", taskId: "t1" }), { kind: "tasksDelete", taskId: "t1" });
  });

  it("rejects a delete without a taskId", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "tasksDelete" }));
  });
});

describe("GoogleArgs — drive", () => {
  it("parses driveList with defaults omitted", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "driveList" }), { kind: "driveList" });
  });

  it("parses driveCreate and allows empty content", () => {
    const args = GoogleArgs.parse({ kind: "driveCreate", name: "notes.txt", content: "" });
    assert.equal(args.kind, "driveCreate");
  });

  it("rejects driveCreate with an empty name", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "driveCreate", name: "", content: "x" }));
  });

  it("rejects driveCreate without content", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "driveCreate", name: "notes.txt" }));
  });

  it("parses driveRead", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "driveRead", fileId: "f1" }), { kind: "driveRead", fileId: "f1" });
  });

  it("rejects driveRead without a fileId", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "driveRead" }));
  });
});

describe("calendarSync args (#2095)", () => {
  it("accepts the bare kind (primary calendar, incremental)", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "calendarSync" }), { kind: "calendarSync" });
  });

  it("accepts an explicit calendarId and fullResync", () => {
    const parsed = GoogleArgs.parse({ kind: "calendarSync", calendarId: "work@group.calendar.google.com", fullResync: true });
    assert.equal(parsed.kind, "calendarSync");
    assert.equal(parsed.calendarId, "work@group.calendar.google.com");
    assert.equal(parsed.fullResync, true);
  });

  it("rejects an empty calendarId (would build a malformed events URL)", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarSync", calendarId: "   " }));
  });

  it("rejects a non-boolean fullResync", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarSync", fullResync: "yes" }));
  });
});
