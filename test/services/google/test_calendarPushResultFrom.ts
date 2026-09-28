// Which report list each thing a push produced ends up in (#3272).
//
// The result's `skipped` means "this push did not do what you asked". A deletion
// Google refused is not that: the record went away here, the event is
// deliberately still standing there, and the rest of the run carried. While the
// two shared one list, a single refusal took the caller's problem branch with it
// and hid every create and update the same push had made.
//
// Driven through the assembler the push actually uses — it is pure, so there is
// nothing to stub — rather than through a helper beside it. A test of a helper
// leaves the assembler free to merge the lists back together.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushResultFrom, type CalendarEventSummary, type DeleteSweep } from "@mulmoclaude/core/google";

const SLUG = "my-schedule";
const REFUSAL = "ev1: left in Google because it has attendees";
const SECOND_REFUSAL = "ev2: left in Google because it has attendees";
const SWEEP_FAILURE = "ev2: 500 from Google";
const UNPUSHABLE = "row-9: needs a mapped start and end";
const PUSH_FAILURE = "row-7: HTTP 500";

const sweep = (overrides: Partial<DeleteSweep> = {}): DeleteSweep => ({ seen: 0, deleted: [], skipped: [], errors: [], ...overrides });

/** A pushed event, as Google answered it. Only its presence matters here — the
 *  counts read the outcome's kind, never the event. */
const event: CalendarEventSummary = {
  id: "ev-1",
  summary: "Standup",
  start: "2026-07-19T09:00:00+09:00",
  end: "2026-07-19T09:15:00+09:00",
  htmlLink: "",
  status: "confirmed",
  colorId: "",
  description: "",
  location: "",
  recurringEventId: "",
  originalStartTime: "",
  updated: "",
  transparency: "",
  eventType: "",
  hangoutLink: "",
  selfResponseStatus: "",
  conferenceVideoUri: "",
};

describe("pushResultFrom — where a refused deletion is reported", () => {
  it("files a refusal under keptInGoogle, never under skipped", () => {
    // THE REGRESSION: merged, the caller reads a refusal as "this push failed"
    // and never reaches the counts of what it did write.
    const result = pushResultFrom(SLUG, [{ eventId: "row-1", outcome: { kind: "created", event } }], sweep({ seen: 1, skipped: [REFUSAL] }));
    assert.deepEqual(result.keptInGoogle, [REFUSAL]);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.created, 1);
  });

  it("files a record that could not be pushed under skipped", () => {
    const result = pushResultFrom(SLUG, [{ eventId: "row-9", outcome: { kind: "skipped", message: UNPUSHABLE } }], sweep());
    assert.deepEqual(result.skipped, [UNPUSHABLE]);
    assert.deepEqual(result.keptInGoogle, []);
  });

  it("keeps all three lists apart when all three happened", () => {
    const result = pushResultFrom(
      SLUG,
      [
        { eventId: "row-1", outcome: { kind: "created", event } },
        { eventId: "row-9", outcome: { kind: "skipped", message: UNPUSHABLE } },
        { eventId: "row-7", outcome: { kind: "error", message: PUSH_FAILURE } },
      ],
      sweep({ seen: 3, deleted: ["ev3"], skipped: [REFUSAL, SECOND_REFUSAL], errors: [SWEEP_FAILURE] }),
    );
    assert.deepEqual(result.skipped, [UNPUSHABLE]);
    // EVERY refusal, in order: told about one of three, the other two are silent
    // divergence — the harm this separation exists to prevent.
    assert.deepEqual(result.keptInGoogle, [REFUSAL, SECOND_REFUSAL]);
    assert.deepEqual(result.errors, [PUSH_FAILURE, SWEEP_FAILURE]);
    assert.equal(result.created, 1);
    // The counts this assembler also owns: `localDeletes` is what went away HERE,
    // never what Google removed, and the pull must be told which records to leave.
    assert.equal(result.localDeletes, 3);
    assert.equal(result.deletedInGoogle, 1);
    assert.deepEqual(result.unpushedIds, ["row-7"]);
  });

  it("treats a sweep FAILURE as an error — a 500 is not a decision", () => {
    const result = pushResultFrom(SLUG, [], sweep({ errors: [SWEEP_FAILURE] }));
    assert.deepEqual(result.errors, [SWEEP_FAILURE]);
    assert.deepEqual(result.keptInGoogle, []);
  });

  it("reports nothing in any of the three when everything carried", () => {
    const result = pushResultFrom(SLUG, [{ eventId: "row-1", outcome: { kind: "updated", event } }], sweep({ seen: 1, deleted: ["ev3"] }));
    assert.deepEqual([result.skipped, result.keptInGoogle, result.errors], [[], [], []]);
    assert.equal(result.updated, 1);
    assert.equal(result.deletedInGoogle, 1);
  });

  it("hands back its own array, so appending to the sweep afterwards cannot change it", () => {
    const source = sweep({ seen: 1, skipped: [REFUSAL] });
    const result = pushResultFrom(SLUG, [], source);
    source.skipped.push("ev9: added later");
    assert.deepEqual(result.keptInGoogle, [REFUSAL]);
  });
});
