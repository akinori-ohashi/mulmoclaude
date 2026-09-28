// Whether a record deleted in the collection may be deleted in Google (#3234).
//
// The push has always REPORTED a local deletion and left Google alone, because
// `events.delete` removes the event for everyone it was sent to and cannot be
// undone from here. A calendar whose collection is the primary copy needs the
// deletion to carry, though — otherwise the next pull brings the record back
// and the user deletes it again, forever.
//
// So propagation is opt-in per collection, and even then it stops at an event
// that carries attendees: deleting an invited event withdraws it from the
// guests' calendars, which is a different act from tidying your own. The rule
// is blunter than that reason — see `planDelete` for why an event only the
// user was ever on is refused too. That guard is here, pure, because it is the
// whole safety of the feature — and it answers from what Google currently
// holds, never from the record, which by then is gone.
//
// Pure: no I/O, no clock, no locale.

/** Why an event was left in Google although its record is gone. */
export type DeleteRefusal = { kind: "has-attendees" } | { kind: "already-gone" };

/** An approval carries the version it was made against, so the delete can be
 *  conditional on it. Keeping the two together is what stops a caller deleting
 *  against a version the guard never saw. */
export type DeleteDecision = { ok: true; etag: string } | ({ ok: false } & DeleteRefusal);

const ATTENDEES_REASON = "it carries attendees — deleting an invited event withdraws it from their calendars too";
const ALREADY_GONE_REASON = "it is no longer in Google";

/** The message the push reports for a refusal, with the event named. */
export const deleteRefusalMessage = (eventId: string, refusal: DeleteRefusal): string =>
  `${eventId}: left in Google because ${refusal.kind === "has-attendees" ? ATTENDEES_REASON : ALREADY_GONE_REASON}`;

/** Decide one deletion against what Google currently holds.
 *
 *  `null` means the event is already absent — a 404/410 on the read. Nothing to
 *  delete, and reported apart from a refusal so "we chose not to" never reads
 *  as "we could not".
 *
 *  ANY attendee refuses, including the entry Google adds for the organiser. A
 *  rule that tried to exclude "only me" would have to work out which entry is
 *  the user from a payload that may not say, and being wrong there withdraws a
 *  real invitation. Solo events — the ones this feature exists for — carry no
 *  attendees at all, so the blunt rule costs them nothing. */
export function planDelete(fetched: { attendeeCount: number; etag: string } | null): DeleteDecision {
  if (fetched === null) return { ok: false, kind: "already-gone" };
  return fetched.attendeeCount > 0 ? { ok: false, kind: "has-attendees" } : { ok: true, etag: fetched.etag };
}
