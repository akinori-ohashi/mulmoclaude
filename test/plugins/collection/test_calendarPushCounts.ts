// The counts the push message states (#3260).
//
// `localDeletes` means "records that went away HERE", whether or not the
// deletion carried — so calling that number "not applied" was true only while
// the push never deleted. `propagateDeletes` (#3234) made it a lie: a user who
// opted in saw "3 local deletions not applied" with the three events gone from
// Google.
//
// These pin the split, in both directions: the number that means "still
// standing in Google" is `localDeletes - deletedInGoogle`, and a collection
// that never opted in must read exactly as it always did.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pushCounts, pushWroteSomething } from "../../../packages/plugins/collection-plugin/src/vue/calendarPushResult";
import type { CollectionPushResult } from "../../../packages/plugins/collection-plugin/src/vue/uiContext";

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

describe("pushCounts — propagateDeletes off (every collection until it opts in)", () => {
  it("reports every local deletion as not applied, which is what the old message said", () => {
    const counts = pushCounts(result({ localDeletes: 3, deletedInGoogle: 0 }));
    assert.equal(counts.deletesNotApplied, 3);
    assert.equal(counts.deletedInGoogle, 0);
  });

  // An older host answers a body with no `deletedInGoogle` at all. The message
  // must read the same as it did before the field existed, not lose the count.
  it("treats an absent deletedInGoogle as zero rather than dropping the deletions", () => {
    const counts = pushCounts(result({ localDeletes: 2 }));
    assert.equal(counts.deletedInGoogle, 0);
    assert.equal(counts.deletesNotApplied, 2);
  });
});

describe("pushCounts — propagateDeletes on", () => {
  it("calls nothing 'not applied' when every deletion carried", () => {
    const counts = pushCounts(result({ localDeletes: 3, deletedInGoogle: 3 }));
    assert.equal(counts.deletedInGoogle, 3);
    assert.equal(counts.deletesNotApplied, 0);
  });

  // The guard refuses an event with attendees and reports it in `skipped`, so
  // the counts must show the split rather than claiming all three landed.
  it("splits the count when the guard refused one", () => {
    const counts = pushCounts(result({ localDeletes: 3, deletedInGoogle: 2, skipped: ["ev3: left in Google because it carries attendees"] }));
    assert.equal(counts.deletedInGoogle, 2);
    assert.equal(counts.deletesNotApplied, 1);
  });

  // Defensive, not hypothetical: the two numbers come from different fields of
  // one response, and a negative count would render as one.
  it("never reports a negative remainder", () => {
    assert.equal(pushCounts(result({ localDeletes: 0, deletedInGoogle: 2 })).deletesNotApplied, 0);
  });
});

describe("pushCounts — the other three counts pass through", () => {
  it("carries created / updated / conflicts unchanged", () => {
    const counts = pushCounts(result({ created: 4, updated: 5, conflicts: 6, localDeletes: 1 }));
    assert.equal(counts.created, 4);
    assert.equal(counts.updated, 5);
    assert.equal(counts.conflicts, 6);
  });
});

// The message picks its wording from `deletedInGoogle`, and `pushWroteSomething`
// decides whether the push counts as work at all. They must agree about a
// deletion-only push, or the view says "nothing happened" and then names a
// count.
describe("pushCounts agrees with pushWroteSomething", () => {
  it("a deletion-only push that carried is work done, and shows the delete wording", () => {
    const deletionOnly = result({ localDeletes: 2, deletedInGoogle: 2 });
    assert.equal(pushWroteSomething(deletionOnly), true);
    assert.equal(pushCounts(deletionOnly).deletedInGoogle > 0, true);
  });

  it("a deletion-only push that did NOT carry is not work done, and shows the old wording", () => {
    const reportedOnly = result({ localDeletes: 2, deletedInGoogle: 0 });
    assert.equal(pushWroteSomething(reportedOnly), false);
    assert.equal(pushCounts(reportedOnly).deletedInGoogle > 0, false);
  });
});
