// A deletion Google refused must not read as a failed push (#3272).
//
// `propagateDeletes` brought the first entry that breaks the old reading of
// `skipped`. While that list held only records that could not be pushed,
// "something is in it" meant "this click did not do what you asked", and the
// banner's early return was right. A refused deletion is not that: the record
// went away here, the event is deliberately still standing there, and the rest
// of the run carried — so one refusal used to hide every create and update.
//
// These pin the two halves of the split in both directions: what the refusal
// reaches, and what it must NOT reach.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pushKeptDeletes, pushProblems } from "../../../packages/plugins/collection-plugin/src/vue/calendarPushResult";
import type { CollectionPushResult } from "../../../packages/plugins/collection-plugin/src/vue/uiContext";

const REFUSAL = "evt-1: left in Google because it has attendees";
const UNPUSHABLE = "row-9: no title";

const result = (overrides: Partial<CollectionPushResult> = {}): CollectionPushResult => ({
  pushed: true,
  created: 0,
  updated: 0,
  conflicts: 0,
  localDeletes: 0,
  skipped: [],
  errors: [],
  ...overrides,
});

describe("pushKeptDeletes", () => {
  it("reports the deletions left standing, with their reasons", () => {
    assert.deepEqual(pushKeptDeletes(result({ keptInGoogle: [REFUSAL] })), [REFUSAL]);
  });

  it("is empty for a host whose body does not carry the key", () => {
    // An older host answers no key at all — absent, not false.
    assert.deepEqual(pushKeptDeletes(result()), []);
  });

  it("is empty when nothing was refused", () => {
    assert.deepEqual(pushKeptDeletes(result({ keptInGoogle: [] })), []);
  });
});

describe("pushProblems and a refused deletion", () => {
  it("does not count a refused deletion as a problem", () => {
    // THE REGRESSION. Non-empty problems take the banner's early return, which
    // is what dropped the counts of everything the push did write.
    assert.deepEqual(pushProblems(result({ created: 10, keptInGoogle: [REFUSAL] })), []);
  });

  it("still counts a record that could not be pushed", () => {
    assert.deepEqual(pushProblems(result({ skipped: [UNPUSHABLE] })), [UNPUSHABLE]);
  });

  it("keeps the two apart when both happened", () => {
    const both = result({ created: 10, skipped: [UNPUSHABLE], keptInGoogle: [REFUSAL] });
    assert.deepEqual(pushProblems(both), [UNPUSHABLE]);
    assert.deepEqual(pushKeptDeletes(both), [REFUSAL]);
  });
});
