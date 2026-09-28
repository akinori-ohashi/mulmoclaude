// Unit tests for the push route's response shaping (#2598).
//
// The rule under test: no setup failure may leave the UI reading "0 created".
// An unlinked account and a read-only calendar both produce zero writes, and a
// body that reports only the counts would present either as "nothing to push" —
// sending the user looking at their data instead of at their settings.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calendarPushBody, pushReadOnlyError, PUSH_NOT_DECLARED_ERROR, PUSH_NOT_LINKED_ERROR } from "../../server/api/routes/collectionCalendarPush.js";
import { isDeniedAccessRole, reportedAccessRole, type CalendarCollectionPushResult } from "@mulmoclaude/core/google";

const result = (overrides: Partial<CalendarCollectionPushResult> = {}): CalendarCollectionPushResult => ({
  slug: "my-schedule",
  created: 0,
  updated: 0,
  conflicts: 0,
  localDeletes: 0,
  deletedInGoogle: 0,
  skipped: [],
  keptInGoogle: [],
  errors: [],
  unpushedIds: [],
  ...overrides,
});

describe("calendarPushBody — states that must not read as success", () => {
  it("reports an unlinked Google account as an error, not an empty push", () => {
    const body = calendarPushBody({ kind: "not-linked" });
    assert.deepEqual(body.errors, [PUSH_NOT_LINKED_ERROR]);
    assert.equal(body.created, 0);
  });

  it("reports a collection that declares no calendar", () => {
    assert.deepEqual(calendarPushBody({ kind: "not-a-calendar" }).errors, [PUSH_NOT_DECLARED_ERROR]);
  });

  it("names the access role when the calendar cannot be written to", () => {
    const body = calendarPushBody({ kind: "read-only", accessRole: "reader" });
    assert.deepEqual(body.errors, [pushReadOnlyError("reader")]);
    assert.match(body.errors[0] ?? "", /owner or writer/);
  });

  it("still explains itself when Google reported no role at all", () => {
    assert.match(pushReadOnlyError(""), /read access/);
  });

  // A setup-phase throw (revoked grant, Calendar API unreachable) used to reach
  // the route as a generic 500 while its siblings answered in this shape.
  // (CodeRabbit review.)
  it("passes a setup failure through as an error in the same shape", () => {
    const body = calendarPushBody({ kind: "failed", message: "Google Calendar API: HTTP 503" });
    assert.deepEqual(body.errors, ["Google Calendar API: HTTP 503"]);
    assert.equal(body.pushed, true);
    assert.equal(body.created, 0);
  });

  it("marks every outcome as `pushed` so the client has one success shape", () => {
    const outcomes = [
      { kind: "not-linked" },
      { kind: "not-a-calendar" },
      { kind: "read-only", accessRole: "reader" },
      { kind: "failed", message: "boom" },
    ] as const;
    for (const outcome of outcomes) {
      assert.equal(calendarPushBody(outcome).pushed, true);
    }
  });
});

describe("isDeniedAccessRole — the up-front writability gate", () => {
  // Refusing before any API call is only allowed on POSITIVE evidence. A
  // calendar absent from `calendarList` reports no role, and hard-denying that
  // would block the feature outright for a calendar shared with write access
  // that the user simply has not added to their list. (Codex review on #2600.)
  it("does not deny a calendar whose role is unknown", () => {
    assert.equal(isDeniedAccessRole(null), false);
  });

  it("allows owner and writer", () => {
    assert.equal(isDeniedAccessRole("owner"), false);
    assert.equal(isDeniedAccessRole("writer"), false);
  });

  it("denies the read-only roles Google reports", () => {
    assert.equal(isDeniedAccessRole("reader"), true);
    assert.equal(isDeniedAccessRole("freeBusyReader"), true);
  });

  // A listed calendar reporting an empty role is evidence of a role we do not
  // recognise, not of an unlisted calendar — those carry null.
  it("denies an unrecognised role rather than assuming it can write", () => {
    assert.equal(isDeniedAccessRole(""), true);
    assert.equal(isDeniedAccessRole("somethingNew"), true);
  });
});

describe("reportedAccessRole — what an unlisted calendar says about itself", () => {
  it("passes a reported role through, so an unlisted read-only calendar is refused up front", () => {
    assert.equal(reportedAccessRole("writer"), "writer");
    assert.equal(isDeniedAccessRole(reportedAccessRole("reader")), true);
  });

  // The pairing that matters: `""` reaching the gate unchanged would refuse
  // every calendar Google declined to report a role for.
  it("turns an unreported role into the unknown the gate lets through", () => {
    assert.equal(reportedAccessRole(""), null);
    assert.equal(isDeniedAccessRole(reportedAccessRole("")), false);
  });
});

describe("calendarPushBody — a real push", () => {
  it("passes the counts through", () => {
    const body = calendarPushBody({ kind: "pushed", result: result({ created: 2, updated: 3, conflicts: 1, localDeletes: 4, deletedInGoogle: 1 }) });
    assert.deepEqual(body, {
      pushed: true,
      created: 2,
      updated: 3,
      conflicts: 1,
      localDeletes: 4,
      deletedInGoogle: 1,
      skipped: [],
      keptInGoogle: [],
      errors: [],
    });
  });

  // `localDeletes` counts what went away HERE and `deletedInGoogle` what the
  // push then removed there. Reporting the first as if it were the second is
  // how a click would claim to have deleted events it deliberately left alone.
  it("keeps the two delete counts apart — reported here is not deleted there", () => {
    const body = calendarPushBody({ kind: "pushed", result: result({ localDeletes: 4, deletedInGoogle: 0 }) });
    assert.equal(body.localDeletes, 4);
    assert.equal(body.deletedInGoogle, 0);
  });

  it("keeps skipped reasons separate from errors — they need different wording", () => {
    const body = calendarPushBody({
      kind: "pushed",
      result: result({ skipped: ["abcde: needs a mapped start and end"], errors: ["ev9: HTTP 500"] }),
    });
    assert.deepEqual(body.skipped, ["abcde: needs a mapped start and end"]);
    assert.deepEqual(body.errors, ["ev9: HTTP 500"]);
  });

  // A refused deletion rides its OWN list to the caller. Merged into `skipped` it
  // took the caller's problem branch with it, and one refusal then hid every
  // create and update the same push made (#3272).
  it("carries a refused deletion apart from records that could not be pushed", () => {
    const body = calendarPushBody({
      kind: "pushed",
      result: result({ created: 10, keptInGoogle: ["ev1: left in Google because it has attendees"], skipped: ["abcde: needs a mapped start and end"] }),
    });
    assert.deepEqual(body.keptInGoogle, ["ev1: left in Google because it has attendees"]);
    assert.deepEqual(body.skipped, ["abcde: needs a mapped start and end"]);
    assert.equal(body.created, 10);
  });

  it("reports a conflict count without touching either side", () => {
    const body = calendarPushBody({ kind: "pushed", result: result({ conflicts: 2 }) });
    assert.equal(body.conflicts, 2);
    assert.deepEqual(body.errors, []);
  });
});
