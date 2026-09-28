// Google event fields that are ARRAYS, folded to the one scalar a collection
// column can hold (#3233).
//
// A collection field is a scalar (`schemaZ.ts`), and `map` names a key of
// `CalendarEventSummary` — so `attendees` (an array) and `conferenceData` (an
// array inside an object) cannot be mapped at all until something decides which
// single value they become. These are those decisions, kept pure and apart from
// the projection so each is testable against the real Google shapes.
//
// Both fold toward the ONE question the collection asks of them: "is this on my
// schedule?" and "where do I join?". Everything else in those structures is
// dropped, deliberately — a column holding the whole attendee list would satisfy
// neither question, because `where` resolves only top-level record fields.
//
// Pure: no I/O, no clock, no locale.
import { isRecord } from "./util.js";

const stringAt = (record: Record<string, unknown>, key: string): string => (typeof record[key] === "string" ? record[key] : "");

const recordsIn = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

/** The signed-in user's own `responseStatus` on this event, `""` when Google
 *  reported none.
 *
 *  `""` is the common case, not an edge one: an event with no attendees has no
 *  entry to mark `self`, which is most of a personal calendar. So it means
 *  "Google said nothing", never "not going" — filter with `!= "declined"`, not
 *  with `== "accepted"`, or every solo event disappears too.
 *
 *  Google's values: `needsAction`, `declined`, `tentative`, `accepted`. */
export function selfResponseStatus(attendees: unknown): string {
  const self = recordsIn(attendees).find((attendee) => attendee.self === true);
  return self === undefined ? "" : stringAt(self, "responseStatus");
}

const VIDEO_ENTRY_POINT = "video";

/** The URL that joins this event's meeting, `""` when it has none.
 *
 *  Only the `video` entry point. The others are a phone number and a dial-in
 *  PIN page, and a column named for joining that sometimes holds `tel:` would
 *  be worse than one that is empty — the caller can see empty and fall back.
 *
 *  `hangoutLink` (#3229) already carries this for Google Meet; this is what
 *  reaches the events whose conference is Zoom or Teams. */
export function conferenceVideoUri(conferenceData: unknown): string {
  if (!isRecord(conferenceData)) return "";
  const video = recordsIn(conferenceData.entryPoints).find((entry) => entry.entryPointType === VIDEO_ENTRY_POINT);
  return video === undefined ? "" : stringAt(video, "uri");
}
