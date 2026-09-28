// Unit tests for the delete guard (#3234).
//
// This is the whole safety of propagating a local deletion, so it is tested in
// both directions: what it lets through, and — the side that matters — what it
// refuses. `events.delete` removes the event for everyone it was sent to, and
// Google's own Trash is the only way back, so a guard that let one attendee
// slip through would take an invitation off other people's calendars.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deleteRefusalMessage, planDelete } from "@mulmoclaude/core/google";

describe("planDelete", () => {
  // The approval carries the version it was made against, so the delete can be
  // conditional on it — the two cannot be separated by a later caller.
  it("allows a solo event, and hands back the version it approved", () => {
    assert.deepEqual(planDelete({ attendeeCount: 0, etag: '"v1"' }), { ok: true, etag: '"v1"' });
  });

  it("refuses an event with anyone on it", () => {
    assert.deepEqual(planDelete({ attendeeCount: 1, etag: '"v1"' }), { ok: false, kind: "has-attendees" });
    assert.deepEqual(planDelete({ attendeeCount: 12, etag: '"v1"' }), { ok: false, kind: "has-attendees" });
  });

  // The organiser's own entry counts. Excluding it would mean deciding which
  // entry is the user from a payload that may not say, and being wrong there
  // withdraws a real invitation — so the rule stays blunt.
  it("refuses an event whose only attendee might be the user", () => {
    assert.deepEqual(planDelete({ attendeeCount: 1, etag: '"v1"' }), { ok: false, kind: "has-attendees" });
  });

  it("reports an event already gone apart from a refusal", () => {
    assert.deepEqual(planDelete(null), { ok: false, kind: "already-gone" });
  });
});

describe("deleteRefusalMessage", () => {
  it("names the event and says which reason applies", () => {
    assert.match(deleteRefusalMessage("ev1", { kind: "has-attendees" }), /^ev1: left in Google because it carries attendees/);
    assert.match(deleteRefusalMessage("ev1", { kind: "already-gone" }), /^ev1: left in Google because it is no longer in Google/);
  });

  // "we chose not to" and "there was nothing to do" must not read alike: the
  // first means the event is still on other people's calendars.
  it("gives the two refusals different wording", () => {
    assert.notEqual(deleteRefusalMessage("ev1", { kind: "has-attendees" }), deleteRefusalMessage("ev1", { kind: "already-gone" }));
  });
});
