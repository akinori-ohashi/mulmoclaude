// Server-only Google engine: local OAuth (loopback + PKCE), token store at
// `~/.config/mulmo/google-token.json`, and REST calls for Calendar, Tasks,
// and Drive (`drive.file` — app-created files only). Shared by the hosts
// (remote-host handlers, /api routes, each host's auth CLI) and the google
// plugin — the token file has a single owner, so every surface sees the same
// link state.
export { configureGoogleHost, type GoogleLogger } from "./host.js";
export { isIsoDateTimeWithOffset } from "./datetime.js";
export { deleteRefusalMessage, planDelete, type DeleteDecision, type DeleteRefusal } from "./deletePlan.js";
export { conferenceVideoUri, selfResponseStatus } from "./eventDerived.js";
export {
  isCalendarDateOnly,
  resolvePartialSpanInput,
  resolveSpanInput,
  toEventTimeInput,
  eventTimeHint,
  EVENT_TIME_HINT,
  ALL_DAY_END_HINT,
  LONE_ALL_DAY_HINT,
  MIXED_SPAN_HINT,
  type PartialSpanResult,
  type PartialSpanTimes,
  type SpanResult,
  type SpanTimes,
} from "./eventSpanInput.js";
export { googleConfigDir, googleSecretsDir, googleTokenPath, legacyGoogleTokenPath } from "./paths.js";
export { clientSecretPresence, findClientSecretPath, loadClientSecret, type ClientSecretPresence, type InstalledClientSecret } from "./clientSecret.js";
export { deleteGoogleTokens, loadGoogleTokens, mergeGoogleTokens, saveGoogleTokens, type IssuedVia, type StoredGoogleTokens } from "./tokenStore.js";
export { brokerBaseUrl, brokerExchange, brokerRefresh, brokerStart, type BrokerStartResponse } from "./broker.js";
export {
  authorizeGoogle,
  commitLinkedTokens,
  getGoogleAccessToken,
  unlinkGoogle,
  waitForAuthCode,
  GOOGLE_AUTH_CANCELLED,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDARLIST_SCOPE,
  GOOGLE_TASKS_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_SCOPES,
  type AuthorizeGoogleOptions,
  type RevokeFetch,
} from "./auth.js";
export { createGoogleAuthFlow, googleAuthFlow, type GoogleAuthFlow, type GoogleAuthFlowStatus } from "./authFlow.js";
export { googleApiError, isGoogleApiError, GoogleApiError, DEFAULT_LIST_MAX_RESULTS, HTTP_FORBIDDEN, MAX_LIST_RESULTS } from "./apiClient.js";
export {
  buildEventPatch,
  calendarApiError,
  collectCalendarPages,
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarColors,
  canonicalCalendarId,
  listCalendarEvents,
  listCalendars,
  syncCalendarEvents,
  toCalendarMeta,
  toCalendarSummary,
  toEventSummary,
  updateCalendarEvent,
  getCalendarEvent,
  getCalendarMeta,
  resolveEventSpan,
  CANCELLED_EVENT_STATUS,
  EVENT_ABSENT_STATUSES,
  HTTP_CONFLICT,
  HTTP_PRECONDITION_FAILED,
  type CalendarColorEntry,
  type CalendarColors,
  type CalendarEventInput,
  type CalendarEventSpan,
  type CalendarEventSummary,
  type CalendarEventTime,
  type CalendarListPage,
  type CalendarMeta,
  type CalendarSummary,
  type CalendarSyncResult,
  type DeleteCalendarEventInput,
  type FetchedCalendarEvent,
  type ListEventsInput,
  type SyncEventsInput,
  type UpdateCalendarEventInput,
  syncPageParams,
} from "./calendar.js";
export {
  calendarSyncStatePath,
  claimCalendarSyncIfDue,
  clearCalendarLastSyncedAt,
  clearCalendarSyncToken,
  loadCalendarLastSyncedAt,
  loadCalendarSyncToken,
  saveCalendarSyncToken,
  toolCalendarSyncKey,
} from "./calendarSyncStore.js";
export { calendarSyncDueWindowMs, isCalendarSyncDue } from "./calendarSyncDue.js";
export { calendarBackfillPath, markCalendarBackfilled, needsCalendarBackfill } from "./calendarBackfillState.js";
export { stateLockPath, withCalendarStateLock, liveLockClock, type LockClock } from "./calendarStateLock.js";
export {
  calendarPushStatePath,
  clearCalendarShadow,
  loadCalendarShadow,
  mergeShadow,
  saveCalendarShadow,
  toShadowEvent,
  type ShadowEvent,
} from "./calendarPushState.js";
export {
  isDeniedAccessRole,
  isUnpushed,
  locallyEditedIds,
  pushCalendarForCollection,
  pushCollectionNow,
  pushResultFrom,
  reportedAccessRole,
  sweepDeletes,
  unsentLocalEdits,
  type DeleteSweep,
  type DeleteSweepDeps,
  type PushAttempt,
  type PushOutcomeKind,
  type CalendarCollectionPushResult,
  type CalendarPushDeps,
  type CalendarPushOutcome,
  type CalendarWriteTarget,
} from "./collectionPush.js";
export { toGoogleEventTime, zoneSuffixOf } from "./pushDateTime.js";
export {
  baselineRecord,
  bySourceField,
  conflictingFields,
  fieldText,
  isClientSettableEventId,
  locallyChangedFields,
  locallyDeletedIds,
  mayAdoptExisting,
  planRecord,
  pushableMap,
  PUSHABLE_SOURCE_FIELDS,
  type PushableSourceField,
  type RecordPlan,
} from "./pushPlan.js";
export { toCollectionDateTime } from "./collectionDateTime.js";
export { withCalendarLock, withKeyedLock } from "./calendarLock.js";
export { toCollectionRecord, type GoogleCalendarSourceField } from "./collectionProjection.js";
// Re-homed to `collection/core` when the feeds ingest turned out to need the
// same merge (#2696). Kept on this subpath so the published surface is unchanged.
export { mergeIntoExisting } from "../collection/core/project.js";
export {
  googleCalendarSyncTaskDef,
  classifyDelete,
  classifyWrite,
  anySyncedCollectionSurvives,
  applyPlanFor,
  groupByCalendar,
  allUnpushed,
  unsentEditGuard,
  heldBack,
  orphanedCalendarId,
  pullableEvents,
  pullProtectionFor,
  pushAndProtect,
  releaseOrphanedCalendarToken,
  unpushedFor,
  PROTECTION_UNKNOWN,
  type ClaimGuard,
  type PullProtectionDeps,
  type UnpushedBySlug,
  syncCalendarForCollection,
  syncCalendarGroup,
  syncDueCalendarCollections,
  syncNewCalendarCollections,
  shadowUpdates,
  collectionsNeedingBackfill,
  resumableToken,
  windowAdvance,
  type WindowAdvance,
  groupsNeedingBackfill,
  withPartialWindowError,
  PARTIAL_CALENDAR_WINDOW,
  GOOGLE_CALENDAR_SYNC_TASK_ID,
  type CalendarCollectionSyncResult,
  type CalendarDeclaring,
  type ManualCalendarSyncDeps,
  type ManualCalendarSyncOutcome,
} from "./collectionSync.js";
export {
  buildTaskPatch,
  canonicalTaskListId,
  completeTask,
  createTask,
  deleteTask,
  listTaskLists,
  listTasks,
  toTaskListSummary,
  toTaskSummary,
  uncompleteTask,
  updateTask,
  type CompleteTaskInput,
  type CreateTaskInput,
  type ListTasksInput,
  type TaskListSummary,
  type TaskSummary,
  type UpdateTaskInput,
} from "./tasks.js";
export {
  assertSafeMimeType,
  buildMultipartBody,
  createDriveFile,
  deleteDriveFile,
  isTextMimeType,
  listDriveFiles,
  pickBoundary,
  readDriveFile,
  toDriveFileSummary,
  type CreateDriveFileInput,
  type DriveFileSummary,
  type ListDriveFilesInput,
  type ReadDriveFileInput,
} from "./driveFile.js";
