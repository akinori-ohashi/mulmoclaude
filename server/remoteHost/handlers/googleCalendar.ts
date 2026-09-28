// google.calendar.* command handlers (remote-host).
//
// The remote (phone) triggers these over the Firestore command channel; the
// Calendar call itself runs here on the host with the locally stored OAuth
// token, so no Google credential ever reaches the cloud. Factories keep the
// validation + mapping unit-testable with the engine stubbed; the default
// exports wire the real auth/calendar functions.
import {
  createCalendarEvent,
  DEFAULT_LIST_MAX_RESULTS,
  deleteCalendarEvent,
  eventTimeHint,
  getCalendarColors,
  getGoogleAccessToken,
  isIsoDateTimeWithOffset,
  listCalendarEvents,
  listCalendars,
  MAX_LIST_RESULTS,
  resolvePartialSpanInput,
  resolveSpanInput,
  updateCalendarEvent,
  type CalendarColorEntry,
  type PartialSpanTimes,
  type SpanTimes,
} from "@mulmoclaude/core/google";
import type { CommandHandler, JsonObject, JsonValue } from "../commandChannel.js";

export interface GoogleCalendarDeps {
  getAccessToken: typeof getGoogleAccessToken;
  createEvent: typeof createCalendarEvent;
  updateEvent: typeof updateCalendarEvent;
  deleteEvent: typeof deleteCalendarEvent;
  listEvents: typeof listCalendarEvents;
  listCalendars: typeof listCalendars;
  getColors: typeof getCalendarColors;
}

const requiredString = (params: JsonObject, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return value;
};

const optionalString = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  // Return trimmed so whitespace can't reach the Google API (matches the
  // plugin's Zod .trim() normalization).
  return value.trim();
};

// Calendar's `timeMin` is RFC3339 and rejects date-only, offset-less, or
// impossible values with an opaque 400, so the strict shared validator runs
// here where the remote gets an actionable message. An event's own `start` /
// `end` go through the span resolver below, which also accepts a bare date.
const asDateTime = (value: string, key: string): string => {
  if (!isIsoDateTimeWithOffset(value)) throw new Error(`${key} must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)`);
  return value;
};

const optionalDateTime = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)`);
  return asDateTime(value, key);
};

// An event span, where each end is either an instant with an offset or a bare
// date for an all-day event. The shared resolver owns the pair rules (both ends
// the same kind, an all-day end after its start) so this and the `google`
// plugin's Zod schema, which validate the SAME Calendar operation, cannot drift.
const optionalSpanText = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(eventTimeHint(key));
  return value;
};

const requiredSpan = (params: JsonObject): SpanTimes => {
  const resolved = resolveSpanInput(requiredString(params, "start"), requiredString(params, "end"));
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.span;
};

const optionalSpan = (params: JsonObject): PartialSpanTimes => {
  const resolved = resolvePartialSpanInput(optionalSpanText(params, "start"), optionalSpanText(params, "end"));
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.times;
};

const clampMaxResults = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_LIST_MAX_RESULTS;
  return Math.min(Math.max(value, 1), MAX_LIST_RESULTS);
};

// Spread rebuilds an anonymous object type — the named CalendarColorEntry
// interface (no index signature) can't satisfy the channel's structural
// JsonValue directly (same constraint as CalendarEventSummary).
const toColorMapJson = (map: Record<string, CalendarColorEntry>): JsonObject =>
  Object.fromEntries(
    Object.entries(map).map(([colorId, entry]): [string, JsonValue] => [colorId, { background: entry.background, foreground: entry.foreground }]),
  );

export const createGoogleCalendarCreateEvent =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const input = {
      summary: requiredString(params, "summary"),
      ...requiredSpan(params),
      description: typeof params.description === "string" ? params.description : undefined,
      calendarId: optionalString(params, "calendarId"),
      colorId: optionalString(params, "colorId"),
    };
    const event = await deps.createEvent(await deps.getAccessToken(), input);
    // Spread rebuilds an anonymous object type — the CalendarEventSummary
    // interface (no index signature) can't satisfy the channel's structural
    // JsonValue directly (same constraint as listAccountingBooks).
    return { event: { ...event } };
  };

// Fields an edit may change. Named so the "at least one" guard and its error
// message can't drift apart, and kept in step with the google plugin's
// EDITABLE_EVENT_FIELDS — the two validate the same Calendar operation.
const EDITABLE_EVENT_FIELDS = ["summary", "start", "end", "description", "colorId"] as const;

// `description` alone accepts "": the patch builder treats `undefined` as
// "leave as is" and "" as "clear it", so routing it through optionalString
// (which rejects empty) would make clearing the body text impossible.
const clearableString = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
};

export const createGoogleCalendarUpdateEvent =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const input = {
      eventId: requiredString(params, "eventId"),
      summary: optionalString(params, "summary"),
      ...optionalSpan(params),
      description: clearableString(params, "description"),
      calendarId: optionalString(params, "calendarId"),
      colorId: optionalString(params, "colorId"),
    };
    // An edit with no edited field PATCHes an empty body — Google answers 200,
    // so the remote would report success for a no-op.
    if (EDITABLE_EVENT_FIELDS.every((field) => params[field] === undefined || params[field] === null)) {
      throw new Error(`pass at least one field to change (${EDITABLE_EVENT_FIELDS.join(", ")})`);
    }
    const event = await deps.updateEvent(await deps.getAccessToken(), input);
    return { event: { ...event } };
  };

export const createGoogleCalendarDeleteEvent =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const eventId = requiredString(params, "eventId");
    await deps.deleteEvent(await deps.getAccessToken(), { eventId, calendarId: optionalString(params, "calendarId") });
    // Google answers 204 with no body; echo the id so the remote can confirm
    // which event went without having to correlate against its own request.
    return { deleted: true, eventId };
  };

export const createGoogleCalendarListEvents =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const timeMin = optionalDateTime(params, "timeMin");
    const maxResults = clampMaxResults(params.maxResults);
    const calendarId = optionalString(params, "calendarId");
    const events = await deps.listEvents(await deps.getAccessToken(), { timeMin, maxResults, calendarId });
    return { events: events.map((event) => ({ ...event })) };
  };

export const createGoogleCalendarListCalendars =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async () => {
    const calendars = await deps.listCalendars(await deps.getAccessToken());
    return { calendars: calendars.map((calendar) => ({ ...calendar })) };
  };

export const createGoogleCalendarColors =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async () => {
    const colors = await deps.getColors(await deps.getAccessToken());
    return { colors: { event: toColorMapJson(colors.event), calendar: toColorMapJson(colors.calendar) } };
  };

const deps: GoogleCalendarDeps = {
  getAccessToken: getGoogleAccessToken,
  createEvent: createCalendarEvent,
  updateEvent: updateCalendarEvent,
  deleteEvent: deleteCalendarEvent,
  listEvents: listCalendarEvents,
  listCalendars,
  getColors: getCalendarColors,
};
export const googleCalendarCreateEvent = createGoogleCalendarCreateEvent(deps);
export const googleCalendarUpdateEvent = createGoogleCalendarUpdateEvent(deps);
export const googleCalendarDeleteEvent = createGoogleCalendarDeleteEvent(deps);
export const googleCalendarListEvents = createGoogleCalendarListEvents(deps);
export const googleCalendarListCalendars = createGoogleCalendarListCalendars(deps);
export const googleCalendarColors = createGoogleCalendarColors(deps);
