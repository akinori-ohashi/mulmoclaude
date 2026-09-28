// Reading a Collection → Google Calendar push result (#2598).
//
// Pure and separate from the view so the rule that decides "did this push have
// something the user must act on" is testable without mounting a component —
// and so `pushCalendar` stays a short orchestration function.
import type { CollectionPushResult } from "./uiContext";

/** Everything the user has to act on, in one list.
 *
 *  `errors` (an unlinked account, a read-only calendar, an API failure) and
 *  `skipped` (a record that cannot be pushed as it stands) are separate fields
 *  on the response because they need different wording upstream, but both mean
 *  "this click did not do what you asked" — so both must reach the banner. A
 *  push that reported only its counts would render a setup failure as
 *  "0 created", which reads as "nothing to do". */
export function pushProblems(result: CollectionPushResult): string[] {
  return [...result.errors, ...result.skipped];
}

/** Deletions Google refused, each with its reason.
 *
 *  Deliberately NOT part of `pushProblems`: the record went away here and the
 *  event is still standing there, which the user has to be told, but the rest of
 *  the push carried. Reported through `pushProblems` it took the banner's early
 *  return with it and hid every successful create and update (#3272).
 *
 *  Empty for an older host: the key is absent from its body, not false. */
export function pushKeptDeletes(result: CollectionPushResult): string[] {
  return result.keptInGoogle ?? [];
}

/** Whether anything reached Google.
 *
 *  A conflict is reported but deliberately not acted on, so it is not work
 *  done. A local deletion only counts once it CARRIED: with `propagateDeletes`
 *  off, `localDeletes` is a report about this side and Google is untouched
 *  (#3234). */
export function pushWroteSomething(result: CollectionPushResult): boolean {
  return result.created > 0 || result.updated > 0 || (result.deletedInGoogle ?? 0) > 0;
}

/** The counts the push message states, with the deletions split.
 *
 *  `localDeletes` means "records that went away HERE", and it means that whether
 *  or not the deletion carried — so it is NOT the number to call "not applied".
 *  Reporting it as such told a user who had opted into `propagateDeletes` that
 *  nothing reached Google while the events were in fact gone (#3260). */
export interface PushCounts {
  created: number;
  updated: number;
  conflicts: number;
  /** Deleted here AND in Google. */
  deletedInGoogle: number;
  /** Deleted here and still standing in Google — no opt-in, or the guard
   *  refused the event. The reason for a refusal rides in `keptInGoogle`. */
  deletesNotApplied: number;
}

export function pushCounts(result: CollectionPushResult): PushCounts {
  const deletedInGoogle = result.deletedInGoogle ?? 0;
  return {
    created: result.created,
    updated: result.updated,
    conflicts: result.conflicts,
    deletedInGoogle,
    // Clamped: an older host answers no `deletedInGoogle` at all, and a
    // negative count here would render as one.
    deletesNotApplied: Math.max(result.localDeletes - deletedInGoogle, 0),
  };
}

/** The message key + interpolation params the push note renders.
 *
 *  Extracted from the view because THIS is where the bug lived: the counts were
 *  right and the sentence built from four of them, so a helper-level test stayed
 *  green while the user read the wrong thing (#3260). A pure function can be
 *  rendered against the real dictionaries and diffed against what the old code
 *  produced; a method inside an SFC cannot be loaded by the test runner at all.
 *
 *  `localDeletes` carries the REMAINDER, not the raw count. The `pushDone`
 *  template says "not applied" about that slot, and the remainder is what is
 *  actually not applied — with no opt-in the two are equal, which is what keeps
 *  the existing sentence byte-identical. */
export interface PushMessage {
  key: "collectionsView.pushDone" | "collectionsView.pushDoneWithDeletes";
  params: Record<string, number>;
}

export function pushMessage(result: CollectionPushResult): PushMessage {
  const counts = pushCounts(result);
  const params = { ...counts, localDeletes: counts.deletesNotApplied };
  // Two keys rather than five slots: a collection that never opted in must not
  // be shown "0 deleted in Google" forever, and for it the remainder equals the
  // old count, so the sentence it already saw is unchanged.
  return counts.deletedInGoogle > 0 ? { key: "collectionsView.pushDoneWithDeletes", params } : { key: "collectionsView.pushDone", params };
}
