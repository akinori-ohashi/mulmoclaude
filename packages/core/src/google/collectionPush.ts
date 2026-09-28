// Collection → Google Calendar push, on demand (#2598).
//
// The mirror of `collectionSync.ts`, and deliberately NOT its automatic twin:
// this runs only when the user clicks, because a push writes to a calendar other
// people may be reading. v1 creates and updates; it never deletes (a Google
// delete removes the event for every attendee and cannot be undone).
//
// Both directions share `withCalendarLock`, so a push can never interleave with
// the pull whose baseline it depends on.
import { discoverCollections } from "../collection/server/discovery.js";
import type { LoadedCollection } from "../collection/server/discoveredCollection.js";
import { storeFor } from "../collection/server/store.js";
import type { CollectionFieldSpec, CollectionItem } from "../collection/core/schema.js";
import { getGoogleAccessToken } from "./auth.js";
import { isGoogleApiError, HTTP_FORBIDDEN } from "./apiClient.js";
import {
  canonicalCalendarId,
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  getCalendarMeta,
  listCalendars,
  updateCalendarEvent,
  CANCELLED_EVENT_STATUS,
  EVENT_ABSENT_STATUSES,
  HTTP_CONFLICT,
  HTTP_PRECONDITION_FAILED,
  type CalendarEventInput,
  type CalendarEventSummary,
  type CalendarEventTime,
  type UpdateCalendarEventInput,
} from "./calendar.js";
import { loadCalendarShadow, saveCalendarShadow, toShadowEvent, type ShadowEvent } from "./calendarPushState.js";
import { withCalendarLock } from "./calendarLock.js";
import { deleteRefusalMessage, planDelete } from "./deletePlan.js";
import { errorMessage } from "./util.js";
import { toGoogleEventTime } from "./pushDateTime.js";
import {
  bySourceField,
  conflictingFields,
  fieldText,
  isClientSettableEventId,
  locallyDeletedIds,
  mayAdoptExisting,
  planRecord,
  pushableMap,
  type PushableSourceField,
} from "./pushPlan.js";
import { loadGoogleTokens } from "./tokenStore.js";
import { log } from "./host.js";

/** Access roles that may write events. `reader` / `freeBusyReader` cannot, and a
 *  push under them fails per event with an opaque 403 — checked once up front so
 *  the user is told the real reason. */
const WRITABLE_ACCESS_ROLES: readonly string[] = ["owner", "writer"];

/** What the up-front writability gate knows about the target calendar. */
export interface CalendarWriteTarget {
  /** The caller's role on the calendar, or null when neither source reported one.
   *  Null means unknown, never read-only: hard-denying an unknown role would
   *  refuse a calendar the user can in fact write to. */
  accessRole: string | null;
  /** IANA zone for rebuilding a zone-less stored clock, `""` when unreported. */
  timeZone: string;
}

/** Whether to refuse the whole push before touching a single event.
 *
 *  Only on POSITIVE evidence of a non-writable role. A calendar whose role
 *  neither source reported is unknown and must fall through: hard-denying it
 *  would block the feature outright for a calendar the user can in fact write
 *  to. Those attempts surface Google's own 403 per record if the write really is
 *  not allowed. */
export const isDeniedAccessRole = (accessRole: string | null): boolean => accessRole !== null && !WRITABLE_ACCESS_ROLES.includes(accessRole);

/** A role Google left blank is UNKNOWN, not a denial. `isDeniedAccessRole`
 *  refuses every role it does not recognise — `""` included — so passing an
 *  unreported one straight through would refuse a calendar Google simply said
 *  nothing about. */
export const reportedAccessRole = (accessRole: string): string | null => accessRole || null;

export interface CalendarCollectionPushResult {
  slug: string;
  created: number;
  updated: number;
  /** Edited on both sides; skipped so neither version is destroyed. */
  conflicts: number;
  /** Records deleted locally. Reported whether or not the deletion carried, so
   *  the count still answers "how many rows went away here". */
  localDeletes: number;
  /** Of those, how many were deleted in Google too. Always `0` unless the
   *  collection opted in with `propagateDeletes` (#3234). */
  deletedInGoogle: number;
  /** Records that cannot be pushed as they stand, each with the reason. */
  skipped: string[];
  /** Deletions the sweep left standing in Google, each with the reason.
   *
   *  NOT merged into `skipped`: that list means "this push did not do what you
   *  asked", and a refused deletion is "it was deliberately not deleted" while
   *  the rest of the run carried. Merging them made one refusal hide every
   *  successful create and update from the caller (#3272). */
  keptInGoogle: string[];
  errors: string[];
  /** Records whose local edit did NOT reach Google and would be destroyed by
   *  the pull that follows an automatic push (#2620).
   *
   *  Only the two states where overwriting loses work with nowhere to recover
   *  it from: a both-sides conflict, and an unexpected failure. A `skipped`
   *  record is deliberately absent — several of its reasons (an id already
   *  taken in Google, an unmappable span) are recovered BY letting the pull
   *  write, so protecting them would stall the collection instead. */
  unpushedIds: string[];
}

export type CalendarPushOutcome =
  | { kind: "pushed"; result: CalendarCollectionPushResult }
  | { kind: "not-a-calendar" }
  | { kind: "not-linked" }
  | { kind: "read-only"; accessRole: string }
  /** The push never got as far as a record: a revoked grant, an unreachable
   *  Calendar API, a workspace read failure. Typed rather than left to throw so
   *  the route answers in the same shape as the other setup problems instead of
   *  an opaque 500. */
  | { kind: "failed"; message: string };

/** The I/O a push crosses, injected so every outcome can be exercised with fakes
 *  instead of a workspace on disk and a live Google grant. */
export interface CalendarPushDeps {
  findCollection: (slug: string, workspaceRoot: string) => Promise<LoadedCollection | null>;
  isLinked: () => Promise<boolean>;
  accessToken: () => Promise<string>;
  calendarMeta: (accessToken: string, calendarId: string | undefined) => Promise<CalendarWriteTarget>;
  /** Read and write for the delete guard. Injected like the rest so a test can
   *  exercise "this event has attendees" without a grant (#3234).
   *
   *  OPTIONAL, unlike the rest: `CalendarPushDeps` is an exported type, and a
   *  deps object written before these existed must keep satisfying it — the
   *  more so because a collection that never opted into `propagateDeletes`
   *  cannot reach either of them. Absent means the live implementation. */
  fetchEvent?: typeof getCalendarEvent;
  deleteEvent?: typeof deleteCalendarEvent;
}

/** Resolve the calendar a schema names, for its writability and its timezone.
 *
 *  The list is consulted first because it answers for every added calendar in
 *  one call the push already makes. `"primary"` is matched on the `primary`
 *  flag, not the id — the primary calendar's own id is the account's email
 *  address, which never equals the literal the schema declares.
 *
 *  A calendar absent from the list is NOT denied: `calendarList` holds only the
 *  calendars the user has added, so one shared with write access can be missing
 *  from it (Codex review). It is asked about itself instead, which reports the
 *  same zone AND the real role. A 404 there means the calendar is genuinely
 *  unreachable, and propagates as a `failed` outcome. */
async function liveCalendarMeta(accessToken: string, calendarId: string | undefined): Promise<CalendarWriteTarget> {
  const key = canonicalCalendarId(calendarId);
  const calendars = await listCalendars(accessToken);
  const listed = key === "primary" ? calendars.find((calendar) => calendar.primary) : calendars.find((calendar) => calendar.id === key);
  if (listed) return { accessRole: listed.accessRole, timeZone: listed.timeZone };
  const direct = await getCalendarMeta(accessToken, calendarId);
  log.info("google", "calendar is not in the user's list — role read from the calendar itself", { calendarId: key, accessRole: direct.accessRole });
  return { accessRole: reportedAccessRole(direct.accessRole), timeZone: direct.timeZone };
}

async function findCalendarCollection(slug: string, workspaceRoot: string): Promise<LoadedCollection | null> {
  const all = await discoverCollections({ workspaceRoot });
  return all.find((collection) => collection.slug === slug && collection.schema.googleCalendar) ?? null;
}

const liveDeps: CalendarPushDeps = {
  findCollection: findCalendarCollection,
  isLinked: async () => Boolean((await loadGoogleTokens())?.refresh_token),
  accessToken: getGoogleAccessToken,
  calendarMeta: liveCalendarMeta,
  fetchEvent: getCalendarEvent,
  deleteEvent: deleteCalendarEvent,
};

/** Everything one record's push needs, resolved once for the whole run. */
interface PushContext {
  accessToken: string;
  calendarId: string | undefined;
  /** The calendar's IANA zone, `""` when Google did not report one. */
  timeZone: string;
  map: Record<string, PushableSourceField>;
  bySource: Partial<Record<PushableSourceField, string>>;
  primaryKey: string;
  fields: Record<string, CollectionFieldSpec>;
  shadow: Record<string, ShadowEvent>;
}

type PushOutcome =
  | { kind: "created"; event: CalendarEventSummary }
  | { kind: "updated"; event: CalendarEventSummary }
  | { kind: "conflict" }
  /** `event` present only when this record's baseline had to be repaired (an
   *  event that already existed in Google), so the write path can persist it. */
  | { kind: "unchanged"; event?: CalendarEventSummary }
  | { kind: "skipped"; message: string }
  | { kind: "error"; message: string };

export type PushOutcomeKind = PushOutcome["kind"];

const localValue = (ctx: PushContext, record: CollectionItem, source: PushableSourceField): unknown => {
  const field = ctx.bySource[source];
  return field === undefined ? undefined : record[field];
};

type TimeResult = { ok: true; time: CalendarEventTime } | { ok: false; reason: string };

/** One end of the span, rebuilt from the stored clock plus whatever the baseline
 *  remembers about the original (zone, all-day). */
function eventTime(ctx: PushContext, record: CollectionItem, source: "start" | "end", previous: string | undefined): TimeResult {
  const value = localValue(ctx, record, source);
  if (value === undefined) return { ok: false, reason: `no \`${source}\` field is mapped` };
  const time = toGoogleEventTime(value, previous, ctx.timeZone);
  if (time === null) return { ok: false, reason: `\`${source}\` is not a date-time Google accepts (got ${JSON.stringify(value)})` };
  // A zone-less dateTime needs `timeZone`; without one Google answers an opaque 400.
  if ("dateTime" in time && time.timeZone === "") return { ok: false, reason: `the calendar reports no timezone, so \`${source}\` cannot be sent without one` };
  return { ok: true, time };
}

/** `description` / `location` for a create — omitted when empty, since there is
 *  nothing to state about an event that carries neither. */
const optionalText = (ctx: PushContext, record: CollectionItem): Pick<CalendarEventInput, "description" | "location"> => {
  const description = fieldText(localValue(ctx, record, "description"));
  const location = fieldText(localValue(ctx, record, "location"));
  return { ...(description ? { description } : {}), ...(location ? { location } : {}) };
};

async function createFromRecord(ctx: PushContext, eventId: string, record: CollectionItem): Promise<PushOutcome> {
  if (!isClientSettableEventId(eventId)) {
    return { kind: "skipped", message: `${eventId}: the record id cannot be used as a Google event id (needs 5-1024 characters from 0-9a-v)` };
  }
  const start = eventTime(ctx, record, "start", undefined);
  const end = eventTime(ctx, record, "end", undefined);
  if (!start.ok) return { kind: "skipped", message: `${eventId}: ${start.reason}` };
  if (!end.ok) return { kind: "skipped", message: `${eventId}: ${end.reason}` };
  const colorId = fieldText(localValue(ctx, record, "colorId"));
  const event = await createCalendarEvent(ctx.accessToken, {
    eventId,
    calendarId: ctx.calendarId,
    summary: fieldText(localValue(ctx, record, "summary")),
    start: start.time,
    end: end.time,
    ...optionalText(ctx, record),
    ...(colorId ? { colorId } : {}),
  });
  return { kind: "created", event };
}

type EventPatch = Pick<UpdateCalendarEventInput, "summary" | "colorId" | "start" | "end" | "description" | "location">;
type PatchResult = { ok: true; patch: EventPatch } | { ok: false; reason: string };

/** The free-text fields of a patch, each only when the local edit touched it.
 *  Unlike `colorId`, `""` is a real value here — Google clears the field. */
const textPatch = (ctx: PushContext, record: CollectionItem, changed: readonly PushableSourceField[]): EventPatch => {
  const touched = (["summary", "description", "location"] as const).filter((source) => changed.includes(source));
  return Object.fromEntries(touched.map((source) => [source, fieldText(localValue(ctx, record, source))]));
};

/** Only the fields the local edit touched — PATCH semantics, so an untouched
 *  attendee list / recurrence rule is left alone. */
function buildPatch(ctx: PushContext, record: CollectionItem, changed: readonly PushableSourceField[], shadow: ShadowEvent): PatchResult {
  const resolved = (["start", "end"] as const)
    .filter((source) => changed.includes(source))
    .map((source) => ({ source, result: eventTime(ctx, record, source, shadow[source]) }));
  const [failure] = resolved.flatMap((entry) => (entry.result.ok ? [] : [entry.result.reason]));
  if (failure !== undefined) return { ok: false, reason: failure };
  const colorId = fieldText(localValue(ctx, record, "colorId"));
  // Calendar rejects "" as a palette id, so a cleared colour cannot be sent.
  // Reported rather than dropped: a silently dropped field leaves the record
  // looking edited forever, re-pushing it on every click.
  if (changed.includes("colorId") && colorId === "") return { ok: false, reason: "Google cannot clear an event colour once set" };
  return {
    ok: true,
    patch: {
      ...textPatch(ctx, record, changed),
      ...(changed.includes("colorId") ? { colorId } : {}),
      ...Object.fromEntries(resolved.flatMap((entry) => (entry.result.ok ? [[entry.source, entry.result.time]] : []))),
    },
  };
}

/** Google has dropped the event this record mirrors.
 *
 *  The advice used to be "sync first, then re-create it", which sent people
 *  nowhere: Google never resends a cancellation, so a sync sees nothing to do —
 *  and before #2688 the sync that DID see it deleted the record along with the
 *  edit. Deliberately silent on whether Google will hand the id back; that is
 *  unverified. */
const goneFromGoogle = (eventId: string): PushOutcome => ({
  kind: "skipped",
  message: `${eventId}: Google no longer has this event, and your local edit was kept. Delete this record, or copy it into a new one.`,
});

async function updateFromRecord(
  ctx: PushContext,
  eventId: string,
  record: CollectionItem,
  changed: readonly PushableSourceField[],
  shadow: ShadowEvent,
): Promise<PushOutcome> {
  const fetched = await getCalendarEvent(ctx.accessToken, { calendarId: ctx.calendarId, eventId });
  if (fetched === null || fetched.event.status === CANCELLED_EVENT_STATUS) return goneFromGoogle(eventId);
  if (conflictingFields(shadow, toShadowEvent(fetched.event), changed).length > 0) return { kind: "conflict" };
  const built = buildPatch(ctx, record, changed, shadow);
  if (!built.ok) return { kind: "skipped", message: `${eventId}: ${built.reason}` };
  try {
    // `If-Match` closes the window between the read above and this write: without
    // it a change landing in between is silently overwritten, which is exactly
    // what the conflict check exists to prevent.
    const event = await updateCalendarEvent(ctx.accessToken, { eventId, calendarId: ctx.calendarId, ifMatch: fetched.etag, ...built.patch });
    return { kind: "updated", event };
  } catch (error) {
    if (isGoogleApiError(error) && error.status === HTTP_PRECONDITION_FAILED) return { kind: "conflict" };
    throw error;
  }
}

/** Create, recovering from the one 409 that is provably safe to recover from.
 *
 *  A 409 means the id is taken, which is USUALLY a previous push whose baseline
 *  never landed. It can also be an unrelated event that happens to hold this id,
 *  so the recovery never writes: it adopts the baseline only when the remote
 *  event already equals what this record would write, and otherwise reports the
 *  fix. Patching whatever answered the 409 would let a push modify a stranger's
 *  event (Codex review).
 *
 *  Refusal is not a dead end — a Sync writes both the record and its baseline,
 *  after which the record pushes normally. */
async function createOrAdopt(ctx: PushContext, eventId: string, record: CollectionItem): Promise<PushOutcome> {
  try {
    return await createFromRecord(ctx, eventId, record);
  } catch (error) {
    if (!isGoogleApiError(error) || error.status !== HTTP_CONFLICT) throw error;
    const fetched = await getCalendarEvent(ctx.accessToken, { calendarId: ctx.calendarId, eventId });
    if (fetched === null) throw error;
    if (mayAdoptExisting(eventId, record, toShadowEvent(fetched.event), ctx.map, ctx.primaryKey, ctx.fields)) {
      return { kind: "unchanged", event: fetched.event };
    }
    return {
      kind: "skipped",
      message: `${eventId}: an event with this id already exists in Google and differs from this record — press Sync to adopt it, then push again`,
    };
  }
}

/** A 403 on a write is a permissions answer, but `googleApiError` appends the
 *  "is the API enabled for the Cloud project?" hint to every 403 — true for a
 *  disabled API, misleading here. Reached when the up-front gate let the push
 *  through on an unknown role, which is exactly when the user needs the real
 *  reason. */
function writeFailure(eventId: string, error: unknown): PushOutcome {
  if (isGoogleApiError(error) && error.status === HTTP_FORBIDDEN) {
    return { kind: "skipped", message: `${eventId}: Google refused the write — you may not have permission to change events on this calendar` };
  }
  return { kind: "error", message: `${eventId}: ${String(error)}` };
}

async function pushRecord(ctx: PushContext, eventId: string, record: CollectionItem): Promise<PushOutcome> {
  try {
    const shadow = ctx.shadow[eventId];
    const plan = planRecord(eventId, record, shadow, ctx.map, ctx.primaryKey, ctx.fields);
    if (plan.kind === "unchanged") return { kind: "unchanged" };
    if (plan.kind === "create" || shadow === undefined) return await createOrAdopt(ctx, eventId, record);
    return await updateFromRecord(ctx, eventId, record, plan.fields, shadow);
  } catch (error) {
    // One rejected event must not abandon the rest of the collection.
    return writeFailure(eventId, error);
  }
}

/** The baseline an outcome establishes, so the next push sees the record as
 *  unchanged instead of pushing it again. Empty for anything that wrote nothing
 *  and had no baseline to repair. */
function pushedShadow(outcomes: readonly PushOutcome[]): Record<string, ShadowEvent> {
  const written = outcomes.flatMap((outcome) => ("event" in outcome && outcome.event !== undefined ? [outcome.event] : []));
  return Object.fromEntries(written.map((event) => [event.id, toShadowEvent(event)]));
}

/** One record's push, kept with the id so the pull can be told which records to
 *  leave alone. */
export interface PushAttempt {
  eventId: string;
  outcome: PushOutcome;
}

/** See `unpushedIds` on the result for why `skipped` is not in this set. */
const UNPUSHED_KINDS: readonly PushOutcome["kind"][] = ["conflict", "error"];

/** Whether this outcome leaves a local edit that only exists locally, so the
 *  pull must not overwrite the record and the baseline must not advance. */
export const isUnpushed = (kind: PushOutcomeKind): boolean => UNPUSHED_KINDS.includes(kind);

/** The whole report one run produces, from what each record's push did and what
 *  the delete sweep did.
 *
 *  A sweep's refusal goes to `keptInGoogle`, NEVER to `skipped`: that list means
 *  "this push did not do what you asked", and a refusal means "the event was
 *  deliberately left standing" while the rest of the run carried. Merged, one
 *  refusal took the caller's problem branch and hid every create and update
 *  (#3272).
 *
 *  Exported because it is pure — a list of attempts and a sweep, no workspace,
 *  grant or clock — so the separation above is something a test drives rather
 *  than argues. */
export function pushResultFrom(slug: string, attempts: readonly PushAttempt[], deletes: DeleteSweep): CalendarCollectionPushResult {
  const outcomes = attempts.map((attempt) => attempt.outcome);
  const count = (kind: PushOutcome["kind"]): number => outcomes.filter((outcome) => outcome.kind === kind).length;
  const messagesOf = (kind: "skipped" | "error"): string[] => outcomes.flatMap((outcome) => (outcome.kind === kind ? [outcome.message] : []));
  return {
    slug,
    created: count("created"),
    updated: count("updated"),
    conflicts: count("conflict"),
    localDeletes: deletes.seen,
    deletedInGoogle: deletes.deleted.length,
    skipped: messagesOf("skipped"),
    // Copied, not aliased: a result handed to a caller must not change if the
    // sweep it came from is appended to later.
    keptInGoogle: [...deletes.skipped],
    errors: [...messagesOf("error"), ...deletes.errors],
    unpushedIds: attempts.filter((attempt) => isUnpushed(attempt.outcome.kind)).map((attempt) => attempt.eventId),
  };
}

/** Record ids whose local value no longer matches the baseline — edits that have
 *  not reached Google.
 *
 *  Pure, and deliberately built from `planRecord`, so it answers with exactly the
 *  records a push WOULD have acted on. A private re-implementation would drift
 *  from the push and protect the wrong set. */
export function locallyEditedIds(
  records: readonly CollectionItem[],
  shadow: Record<string, ShadowEvent>,
  map: Record<string, PushableSourceField>,
  primaryKey: string,
  fields: Record<string, CollectionFieldSpec>,
): string[] {
  const ids = records.map((record) => ({ eventId: fieldText(record[primaryKey]), record }));
  return ids
    .filter(({ eventId, record }) => planRecord(eventId, record, shadow[eventId], map, primaryKey, fields).kind !== "unchanged")
    .map(({ eventId }) => eventId);
}

/** The same set, read from the workspace.
 *
 *  Needed when a push cannot run AT ALL — a calendar whose role degraded to
 *  reader, a revoked grant, an IO failure. The pull still runs, since reading
 *  needs no write access, and would overwrite exactly these records while
 *  advancing their baseline past the edit (CodeRabbit review #2666). Computed
 *  from the stored baseline alone, so it works precisely when Google is the
 *  thing that is unreachable. */
export async function unsentLocalEdits(collection: LoadedCollection, workspaceRoot: string): Promise<string[]> {
  const { schema } = collection;
  const shadow = await loadCalendarShadow(schema.googleCalendar?.calendarId, workspaceRoot);
  const records = await storeFor(collection, { workspaceRoot }).list();
  return locallyEditedIds(records, shadow, pushableMap(schema.googleCalendar?.map ?? {}), schema.primaryKey, schema.fields);
}

/** What one run's deletions did. `seen` counts every record that went away
 *  locally, whether or not the deletion carried — so the count means the same
 *  thing with the feature off as it always did. */
export interface DeleteSweep {
  seen: number;
  deleted: string[];
  /** Deletions left standing in Google, each with the reason. Reported apart
   *  from the push's own `skipped` on the result: that list means "could not be
   *  sent", and a refusal means "deliberately left alone" (#3272). */
  skipped: string[];
  errors: string[];
}

const noDeletes = (seen: number): DeleteSweep => ({ seen, deleted: [], skipped: [], errors: [] });

/** What `sweepDeletes` needs, narrowed to the three effects it has. Taken as an
 *  argument rather than reached for, so the guard can be exercised against
 *  "this event has attendees" with no grant and no workspace. */
export interface DeleteSweepDeps {
  /** What Google currently holds for the event, or null when it is gone. The
   *  `etag` is the version the decision was made against. */
  fetchEvent: (eventId: string) => Promise<{ attendeeCount: number; etag: string } | null>;
  /** Delete it, conditional on that version. */
  deleteEvent: (eventId: string, ifMatch: string) => Promise<void>;
  /** Drop the event's baseline entry. */
  forget: (eventId: string) => Promise<void>;
}

/** A delete whose event changed in Google between the guard reading it and the
 *  delete landing. Reported rather than retried: what changed may be the very
 *  thing the guard refuses, and re-reading in a loop would race the same way. */
const staleDeleteMessage = (eventId: string): string =>
  `${eventId}: left in Google because it changed there while this push was checking it — press Push again to re-check`;

/** Delete ONE event and forget its baseline, or say why it was left alone.
 *
 *  The baseline entry goes only after Google confirms, and it must go: the
 *  baseline is what `locallyDeletedIds` reads, so a kept entry would re-report
 *  the same deletion on every run forever. A refusal keeps its entry on
 *  purpose — the event IS still standing in Google, and the report is the only
 *  thing saying so.
 *
 *  The delete carries the etag the guard read. Without it, an attendee added
 *  between the two requests would be withdrawn by a decision taken before they
 *  existed — the same race `updateCalendarEvent` already guards, and it costs
 *  more here because a delete cannot be undone from this side. */
async function propagateOneDelete(eventId: string, deps: DeleteSweepDeps): Promise<Partial<DeleteSweep>> {
  const decision = planDelete(await deps.fetchEvent(eventId));
  if (!decision.ok) {
    // An event already gone needs no report and no baseline: nothing is left to
    // diverge, so dropping the entry stops a permanent phantom deletion.
    if (decision.kind === "already-gone") {
      await deps.forget(eventId);
      return {};
    }
    return { skipped: [deleteRefusalMessage(eventId, decision)] };
  }
  try {
    await deps.deleteEvent(eventId, decision.etag);
  } catch (error) {
    if (!isGoogleApiError(error)) throw error;
    // Gone between the read and the delete: the outcome asked for, reached by
    // someone else. Forgetting the baseline is what stops the phantom.
    if (EVENT_ABSENT_STATUSES.includes(error.status)) {
      await deps.forget(eventId);
      return {};
    }
    if (error.status !== HTTP_PRECONDITION_FAILED) throw error;
    return { skipped: [staleDeleteMessage(eventId)] };
  }
  await deps.forget(eventId);
  // Ids only — a summary is personal content, and Google's own Trash is where a
  // deleted event is recovered from, never from this log.
  log.info("google", "calendar event deleted by push", { id: eventId });
  return { deleted: [eventId] };
}

/** Carry every local deletion, when the collection opted in.
 *
 *  Sequential rather than concurrent: each one writes the shared baseline file,
 *  and an interrupted run has to leave a state the next run resumes from rather
 *  than a partially applied batch. */
export async function sweepDeletes(eventIds: readonly string[], propagate: boolean, deps: DeleteSweepDeps): Promise<DeleteSweep> {
  if (!propagate || eventIds.length === 0) return noDeletes(eventIds.length);
  const sweep = noDeletes(eventIds.length);
  for (const eventId of eventIds) {
    try {
      const one = await propagateOneDelete(eventId, deps);
      sweep.deleted.push(...(one.deleted ?? []));
      sweep.skipped.push(...(one.skipped ?? []));
    } catch (error) {
      // Reported, not thrown: one unreachable event must not abandon the rest,
      // and its baseline stays, so the next run tries again.
      sweep.errors.push(`${eventId}: could not be deleted in Google — ${errorMessage(error)}`);
    }
  }
  return sweep;
}

/** Push one collection WITHOUT taking the calendar lock.
 *
 *  The caller must already hold it. The scheduled push→pull cycle
 *  (`collectionSync.ts`) runs inside the lock it took for the pull, and the lock
 *  is not reentrant — going through `pushCalendarForCollection` there would make
 *  the sync wait on itself forever. */
export async function pushCollectionNow(collection: LoadedCollection, workspaceRoot: string, deps: CalendarPushDeps = liveDeps): Promise<CalendarPushOutcome> {
  const { schema, slug } = collection;
  const calendarId = schema.googleCalendar?.calendarId;
  const accessToken = await deps.accessToken();
  const meta = await deps.calendarMeta(accessToken, calendarId);
  if (isDeniedAccessRole(meta.accessRole)) return { kind: "read-only", accessRole: meta.accessRole ?? "" };

  const map = pushableMap(schema.googleCalendar?.map ?? {});
  const shadow = await loadCalendarShadow(calendarId, workspaceRoot);
  const records = await storeFor(collection, { workspaceRoot }).list();
  const ctx: PushContext = {
    accessToken,
    calendarId,
    timeZone: meta.timeZone,
    map,
    bySource: bySourceField(map),
    primaryKey: schema.primaryKey,
    fields: schema.fields,
    shadow,
  };

  const attempts: PushAttempt[] = [];
  for (const record of records) {
    const eventId = fieldText(record[schema.primaryKey]);
    const outcome = await pushRecord(ctx, eventId, record);
    attempts.push({ eventId, outcome });
    // Persisted per record, not once at the end: an interruption after a
    // successful write would otherwise leave that event with no baseline, and
    // the next push would retry it as a create and hit Google's duplicate-id
    // 409. Costs nothing for a record that wrote nothing (empty batch).
    await saveCalendarShadow(calendarId, pushedShadow([outcome]), workspaceRoot);
  }
  const deletedIds = locallyDeletedIds(
    shadow,
    records.map((record) => fieldText(record[schema.primaryKey])),
  );
  const deletes = await sweepDeletes(deletedIds, schema.googleCalendar?.propagateDeletes === true, {
    fetchEvent: (eventId) => (deps.fetchEvent ?? getCalendarEvent)(accessToken, { calendarId, eventId }),
    deleteEvent: (eventId, ifMatch) => (deps.deleteEvent ?? deleteCalendarEvent)(accessToken, { calendarId, eventId, ifMatch }),
    forget: (eventId) => saveCalendarShadow(calendarId, { [eventId]: null }, workspaceRoot),
  });
  const result = pushResultFrom(slug, attempts, deletes);
  if (result.errors.length > 0) log.warn("google", "calendar push finished with errors", { slug, errors: result.errors.length });
  return { kind: "pushed", result };
}

/** Push ONE collection's records to the calendar it declares.
 *
 *  "Does this collection sync at all" is answered before "is Google linked", for
 *  the reason `syncCalendarForCollection` gives: telling someone to link their
 *  account for a collection that never declared a calendar sends them fixing the
 *  wrong thing. */
export async function pushCalendarForCollection(slug: string, workspaceRoot: string, deps: CalendarPushDeps = liveDeps): Promise<CalendarPushOutcome> {
  try {
    const collection = await deps.findCollection(slug, workspaceRoot);
    if (collection === null) return { kind: "not-a-calendar" };
    if (!(await deps.isLinked())) return { kind: "not-linked" };
    return await withCalendarLock(collection.schema.googleCalendar?.calendarId, () => pushCollectionNow(collection, workspaceRoot, deps));
  } catch (error) {
    // A throw here is a setup failure (revoked grant, Calendar API unreachable,
    // unreadable workspace), not a per-record one. Reported in the same typed
    // shape as the other setup problems so the route need not guess.
    log.warn("google", "calendar push could not start", { slug, error: String(error) });
    return { kind: "failed", message: String(error) };
  }
}
