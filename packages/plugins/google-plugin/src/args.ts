// Zod arg schemas for the `google` tool, in their own module so the
// dispatch (index.ts) and the tests can share them without pulling in
// the definePlugin factory body.
import { z } from "zod";
import type { z as ZodNamespace } from "zod";
import {
  isIsoDateTimeWithOffset,
  resolvePartialSpanInput,
  resolveSpanInput,
  toEventTimeInput,
  EVENT_TIME_HINT,
  MAX_LIST_RESULTS,
  type PartialSpanResult,
  type SpanResult,
} from "@mulmoclaude/core/google";

// Calendar rejects date-only / offset-less / impossible values on `dateTime`
// with an opaque 400, so the strict shared validator runs here where the LLM
// gets an actionable message.
const IsoDateTimeWithOffset = z.string().refine(isIsoDateTimeWithOffset, {
  error: "must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)",
});

// One end of an event span: an instant, or a bare date for an all-day event.
// Whether the two ends AGREE is a pair-level rule, reported by the span checks
// below — this only rejects a value that is neither shape.
const EventTime = z.string().refine((value) => toEventTimeInput(value) !== null, { error: EVENT_TIME_HINT });

/** Report a span rule the per-value check cannot see: the two ends must be the
 *  same kind, and an all-day end must fall after its start. Both are opaque
 *  400s from Calendar, so they are caught here where the LLM is told the rule.
 *  The shared resolver owns it, so the remote-host handler validating the same
 *  operation cannot drift. */
const addSpanIssue = (ctx: ZodNamespace.RefinementCtx, result: SpanResult | PartialSpanResult): void => {
  if (result.ok) return;
  ctx.addIssue({ code: "custom", message: result.reason });
};

const MaxResults = z.number().int().min(1).max(MAX_LIST_RESULTS).optional();
const NonEmpty = z.string().min(1);
// Trimmed + non-empty: a blank calendarId / taskListId would build a malformed
// `/calendars//events` or `/lists//tasks` URL instead of falling back to the
// default, and colorId "" would be sent as a bad palette id.
const OptionalNonEmpty = z.string().trim().min(1).optional();

// Fields an update kind may change. Named so the "at least one" guard and its
// error message can't drift apart from the schema.
const EDITABLE_EVENT_FIELDS = ["summary", "start", "end", "description", "colorId"] as const;
const EDITABLE_TASK_FIELDS = ["title", "notes", "due"] as const;

export const GoogleArgs = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  // Calendar
  z.object({ kind: z.literal("calendarListCalendars") }),
  z.object({ kind: z.literal("calendarColors") }),
  z.object({
    kind: z.literal("calendarListEvents"),
    calendarId: OptionalNonEmpty,
    timeMin: IsoDateTimeWithOffset.optional(),
    maxResults: MaxResults,
  }),
  z.object({
    kind: z.literal("calendarSync"),
    calendarId: OptionalNonEmpty,
    fullResync: z.boolean().optional(),
  }),
  z
    .object({
      kind: z.literal("calendarCreateEvent"),
      summary: NonEmpty,
      start: EventTime,
      end: EventTime,
      description: z.string().optional(),
      calendarId: OptionalNonEmpty,
      colorId: OptionalNonEmpty,
    })
    .superRefine((args, ctx) => addSpanIssue(ctx, resolveSpanInput(args.start, args.end))),
  z
    .object({
      kind: z.literal("calendarUpdateEvent"),
      eventId: NonEmpty,
      summary: NonEmpty.optional(),
      start: EventTime.optional(),
      end: EventTime.optional(),
      description: z.string().optional(),
      calendarId: OptionalNonEmpty,
      colorId: OptionalNonEmpty,
    })
    // An edit with no edited field would PATCH an empty body — a wasted call
    // that answers 200, so the LLM would report success on a no-op.
    .refine((args) => EDITABLE_EVENT_FIELDS.some((field) => args[field] !== undefined), {
      error: `pass at least one field to change (${EDITABLE_EVENT_FIELDS.join(", ")})`,
    })
    .superRefine((args, ctx) => addSpanIssue(ctx, resolvePartialSpanInput(args.start, args.end))),
  z.object({
    kind: z.literal("calendarDeleteEvent"),
    eventId: NonEmpty,
    calendarId: OptionalNonEmpty,
  }),
  // Tasks
  z.object({ kind: z.literal("taskListsList") }),
  z.object({
    kind: z.literal("tasksList"),
    taskListId: OptionalNonEmpty,
    maxResults: MaxResults,
    showCompleted: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("tasksCreate"),
    title: NonEmpty,
    notes: z.string().optional(),
    due: IsoDateTimeWithOffset.optional(),
    taskListId: OptionalNonEmpty,
  }),
  z
    .object({
      kind: z.literal("tasksUpdate"),
      taskId: NonEmpty,
      title: NonEmpty.optional(),
      notes: z.string().optional(),
      due: IsoDateTimeWithOffset.optional(),
      taskListId: OptionalNonEmpty,
    })
    .refine((args) => EDITABLE_TASK_FIELDS.some((field) => args[field] !== undefined), {
      error: `pass at least one field to change (${EDITABLE_TASK_FIELDS.join(", ")})`,
    }),
  z.object({
    kind: z.literal("tasksComplete"),
    taskId: NonEmpty,
    taskListId: OptionalNonEmpty,
  }),
  // Its own kind rather than a flag on tasksComplete or a status field on
  // tasksUpdate: one kind per target state keeps the name honest and leaves a
  // single code path setting each value (#2574).
  z.object({
    kind: z.literal("tasksUncomplete"),
    taskId: NonEmpty,
    taskListId: OptionalNonEmpty,
  }),
  z.object({
    kind: z.literal("tasksDelete"),
    taskId: NonEmpty,
    taskListId: OptionalNonEmpty,
  }),
  // Drive (drive.file scope — app-created files only)
  z.object({ kind: z.literal("driveList"), maxResults: MaxResults }),
  z.object({
    kind: z.literal("driveCreate"),
    name: NonEmpty,
    content: z.string(),
    mimeType: z.string().optional(),
  }),
  z.object({ kind: z.literal("driveRead"), fileId: NonEmpty }),
]);
export type GoogleArgs = z.infer<typeof GoogleArgs>;
