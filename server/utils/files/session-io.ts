import { appendFile, rm } from "fs/promises";
import path from "node:path";
import { WORKSPACE_DIRS, workspacePath } from "../../workspace/paths.js";
import { isChatModel, type ChatModel } from "../../../src/config/models.js";
import { readTextUnder, writeTextUnder, resolvePath, ensureWorkspaceDir } from "./workspace-io.js";
import { isRecord } from "../types.js";
import { isSessionOrigin, type SessionOrigin } from "../../../src/types/session.js";
import { AGENT_BACKEND_IDS, type AgentBackendId } from "../../system/config.js";
import { isSafeSessionId } from "./sessionId.js";
import { log } from "../../system/logger/index.js";

const CHAT = WORKSPACE_DIRS.chat;
const root = (rootOverride?: string) => rootOverride ?? workspacePath;

export function ensureChatDir(): void {
  ensureWorkspaceDir(CHAT);
}

// Null for an id that is not path-safe. The two functions below are the ONLY
// places a session id becomes a path, so refusing here is what makes the rule
// hold for every reader, writer and future caller at once — `path.posix.join`
// normalises `../` away, which is how `../../config/settings` once resolved
// onto the app's own settings file. Nullable rather than throwing so the
// compiler names every consumer, and so a filesystem scan can skip an odd
// filename instead of failing the whole listing.
function metaRel(sessionId: string): string | null {
  if (!isSafeSessionId(sessionId)) return null;
  return path.posix.join(CHAT, `${sessionId}.json`);
}

function jsonlRel(sessionId: string): string | null {
  if (!isSafeSessionId(sessionId)) return null;
  return path.posix.join(CHAT, `${sessionId}.jsonl`);
}

export interface SessionMeta {
  roleId?: string | undefined;
  startedAt?: string | undefined;
  firstUserMessage?: string | undefined;
  claudeSessionId?: string | undefined;
  agentSession?: AgentSessionRef | undefined;
  hasUnread?: boolean | undefined;
  isBookmarked?: boolean | undefined;
  origin?: SessionOrigin | undefined;
  /** Number of user turns (queries) sent to this session. Bumped once
   *  per user message so a one-shot session (1) can be told apart from
   *  a long-running conversation. */
  userQueryCount?: number | undefined;
  /** A one-off model override for THIS conversation (#3147) — the most
   *  specific level of `session → role → app-wide → shared`. Distinct from
   *  `resolvedModel` below on purpose: this is what the user CHOSE, that is
   *  what the CLI REPORTED. Same word as `AppSettings.chatModel` because it is
   *  the same kind of thing, one scope down. */
  chatModel?: ChatModel | undefined;
  /** The model the CLI reported for this session in its `system`/`init`
   *  frame — a concrete id like `claude-haiku-4-5-20251001`, or one carrying
   *  a context suffix (`claude-opus-5[1m]`) when the shared
   *  `~/.claude/settings.json` supplied it. Stored raw: it is an observation,
   *  not a setting, and the UI formats it for display (#2554). Rewritten each
   *  turn, so a session whose model changed mid-conversation reports the
   *  latest rather than the first. */
  resolvedModel?: string | undefined;
  [key: string]: unknown;
}

export interface AgentSessionRef {
  backendId: AgentBackendId;
  token: string;
}

export type ReadMetaResult = { kind: "missing" } | { kind: "ok"; meta: SessionMeta } | { kind: "corrupt"; raw: string };

/** `chatModel` is validated here rather than carried as a loose string: unlike
 *  `resolvedModel` (an observation we only display) this one reaches
 *  `claude --model`, so a hand-edited session file must not be able to put an
 *  arbitrary value on the command line. */
const isOptionalChatModel = (value: unknown): boolean => value === undefined || isChatModel(value);

/** An alias this build does not know is dropped, never treated as a corrupt
 *  file: `CHAT_MODELS` can gain or retire a name between versions, and
 *  condemning the whole sidecar over one optional field would take the
 *  conversation's role, title and bookmark with it. Dropping it lands on "no
 *  override", which is the level below and already a valid state. The value
 *  does not survive the next write, so a downgrade forgets a newer alias. */
function dropUnknownChatModel(value: unknown): unknown {
  if (!isRecord(value) || isOptionalChatModel(value.chatModel)) return value;
  const { chatModel: __unknown, ...rest } = value;
  return rest;
}
const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === "string";
const isOptionalBoolean = (value: unknown): boolean => value === undefined || typeof value === "boolean";

function isAgentSessionRef(value: unknown): value is AgentSessionRef {
  if (!isRecord(value) || typeof value.token !== "string") return false;
  return AGENT_BACKEND_IDS.some((backendId) => backendId === value.backendId);
}

// Checks every field `SessionMeta` declares. The trailing index signature
// accepts anything, so the extra keys older builds may have written ride
// along untouched — nothing is dropped and nothing is left unverified.
function isSessionMeta(value: unknown): value is SessionMeta {
  return (
    isRecord(value) &&
    isOptionalString(value.roleId) &&
    isOptionalString(value.startedAt) &&
    isOptionalString(value.firstUserMessage) &&
    isOptionalString(value.claudeSessionId) &&
    (value.agentSession === undefined || isAgentSessionRef(value.agentSession)) &&
    isOptionalChatModel(value.chatModel) &&
    (value.agentSession === undefined || isAgentSessionRef(value.agentSession)) &&
    isOptionalString(value.resolvedModel) &&
    isOptionalBoolean(value.hasUnread) &&
    isOptionalBoolean(value.isBookmarked) &&
    (value.origin === undefined || isSessionOrigin(value.origin)) &&
    (value.userQueryCount === undefined || typeof value.userQueryCount === "number")
  );
}

export async function readSessionMetaFull(sessionId: string, rootOverride?: string): Promise<ReadMetaResult> {
  const rel = metaRel(sessionId);
  if (rel === null) return { kind: "missing" };
  const raw = await readTextUnder(root(rootOverride), rel);
  if (raw === null) return { kind: "missing" };
  // A file whose fields don't match the declared types joins the existing
  // "corrupt" branch rather than getting a new one: the caller's contract is
  // already "warn, treat as existing, never clobber", which is exactly the
  // right handling for a meta file we can't trust.
  const parsed: unknown = dropUnknownChatModel(tryParseJson(raw));
  return isSessionMeta(parsed) ? { kind: "ok", meta: parsed } : { kind: "corrupt", raw };
}

/** `undefined` on unparseable input — no JSON document parses to `undefined`,
 *  so it is unambiguous as a sentinel. */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// Treats corrupt as null — callers that need to distinguish use readSessionMetaFull.
export async function readSessionMeta(sessionId: string, rootOverride?: string): Promise<SessionMeta | null> {
  const result = await readSessionMetaFull(sessionId, rootOverride);
  return result.kind === "ok" ? result.meta : null;
}

export async function writeSessionMeta(sessionId: string, meta: SessionMeta, rootOverride?: string): Promise<void> {
  const rel = metaRel(sessionId);
  if (rel === null) {
    refuseUnsafeSessionId(sessionId, "write meta");
    return;
  }
  await writeTextUnder(root(rootOverride), rel, JSON.stringify(meta, null, 2));
}

export async function createSessionMeta(sessionId: string, roleId: string, firstUserMessage: string, rootOverride?: string, origin?: string): Promise<void> {
  const meta: Record<string, unknown> = {
    roleId,
    startedAt: new Date().toISOString(),
    firstUserMessage,
  };
  if (origin) meta.origin = origin;
  await writeSessionMeta(sessionId, meta, rootOverride);
}

/** Says a refusal out loud. The refusing is done by `metaRel` / `jsonlRel`
 *  returning null; this only reports it, for the operations where silence
 *  would look like success. The id itself is never logged — it is the hostile
 *  value — so the length stands in for it. */
function refuseUnsafeSessionId(sessionId: string, action: string): void {
  log.warn("session-io", "refused a session id that is not path-safe", { action, length: sessionId.length });
}

/** Serialises `task` against every other task holding the same key. Keyed by
 *  the resolved file path, so two workspaces never wait on each other, and the
 *  entry is dropped once this call is the tail so the map cannot grow with the
 *  session count. The stored chain never rejects — a failed mutation must not
 *  poison the next one in line — while the caller still sees its own error. */
const metaWriteChains = new Map<string, Promise<void>>();

async function runExclusively(key: string, task: () => Promise<void>): Promise<void> {
  const previous = metaWriteChains.get(key) ?? Promise.resolve();
  const queued = previous.then(task, task);
  const settled = queued.then(
    () => undefined,
    () => undefined,
  );
  metaWriteChains.set(key, settled);
  try {
    await queued;
  } finally {
    if (metaWriteChains.get(key) === settled) metaWriteChains.delete(key);
  }
}

/** The one way to change a session's sidecar. Every mutator is a whole-file
 *  read-modify-write, so two overlapping on one session drop whichever field
 *  the loser wrote — measured, not feared: 40 concurrent `chatModel` /
 *  `resolvedModel` pairs lost one of the two every single time. Doing the read
 *  INSIDE the critical section is what fixes it.
 *
 *  `mutate` returns null to write nothing, which is how the "already set" and
 *  "unchanged" cases stay a single early return. */
async function mutateSessionMeta(sessionId: string, rootOverride: string | undefined, mutate: (meta: SessionMeta) => SessionMeta | null): Promise<void> {
  const rel = metaRel(sessionId);
  if (rel === null) {
    refuseUnsafeSessionId(sessionId, "mutate meta");
    return;
  }
  await runExclusively(resolvePath(root(rootOverride), rel), async () => {
    const meta = await readSessionMeta(sessionId, rootOverride);
    if (!meta) return;
    const next = mutate(meta);
    if (next) await writeSessionMeta(sessionId, next, rootOverride);
  });
}

export async function backfillOrigin(sessionId: string, origin: NonNullable<SessionMeta["origin"]>, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => (meta.origin ? null : { ...meta, origin }));
}

export async function backfillFirstUserMessage(sessionId: string, message: string, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => (meta.firstUserMessage ? null : { ...meta, firstUserMessage: message }));
}

export async function setClaudeSessionId(sessionId: string, claudeSessionId: string, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => ({ ...meta, claudeSessionId }));
}

export async function clearClaudeSessionId(sessionId: string, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, ({ claudeSessionId: __removed, ...rest }) => rest);
}

export async function setAgentSession(sessionId: string, agentSession: AgentSessionRef, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => {
    const legacy = agentSession.backendId === "claude-code" ? { claudeSessionId: agentSession.token } : {};
    return { ...meta, ...legacy, agentSession };
  });
}

export async function clearAgentSession(sessionId: string, backendId: AgentBackendId, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => {
    const legacyClaude = backendId === "claude-code" && meta.agentSession === undefined && typeof meta.claudeSessionId === "string";
    if (meta.agentSession?.backendId !== backendId && !legacyClaude) return null;
    const { agentSession: __agentSession, ...withoutAgentSession } = meta;
    if (backendId !== "claude-code") return withoutAgentSession;
    const { claudeSessionId: __claudeSessionId, ...rest } = withoutAgentSession;
    return rest;
  });
}

export async function updateHasUnread(sessionId: string, hasUnread: boolean, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => ({ ...meta, hasUnread }));
}

export async function updateIsBookmarked(sessionId: string, isBookmarked: boolean, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => ({ ...meta, isBookmarked }));
}

/** `undefined` clears the override, which is what "back to the default" does.
 *  The key has to LEAVE the file — a stored empty value would shadow the role
 *  and the app-wide setting forever — and `writeSessionMeta`'s `JSON.stringify`
 *  is what drops it, since `undefined` is not representable in JSON. That is
 *  load-bearing rather than incidental, so `test_session_io.ts` asserts the key
 *  is absent, not merely falsy: a writer that preserved `undefined` would
 *  reintroduce the bug this comment is about. */
export async function updateSessionChatModel(sessionId: string, chatModel: ChatModel | undefined, rootOverride?: string): Promise<void> {
  // The parameter type is not the guard: this value ends up on the
  // `claude --model` command line, and TypeScript is gone by then.
  if (chatModel !== undefined && !isChatModel(chatModel)) {
    log.warn("session-io", "refused to store an alias that is not a known one");
    return;
  }
  await mutateSessionMeta(sessionId, rootOverride, (meta) => (meta.chatModel === chatModel ? null : { ...meta, chatModel }));
}

export async function updateResolvedModel(sessionId: string, resolvedModel: string, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => (meta.resolvedModel === resolvedModel ? null : { ...meta, resolvedModel }));
}

export async function incrementUserQueryCount(sessionId: string, rootOverride?: string): Promise<void> {
  await mutateSessionMeta(sessionId, rootOverride, (meta) => ({
    ...meta,
    userQueryCount: (typeof meta.userQueryCount === "number" ? meta.userQueryCount : 0) + 1,
  }));
}

// Hard-deletes the session's .jsonl event log and .json meta sidecar.
// Missing files are tolerated — callers may invoke this for sessions
// whose meta or jsonl was never written (e.g. a crash mid-create).
export async function deleteSessionFiles(sessionId: string, rootOverride?: string): Promise<void> {
  // Guarded for the same reason as every writer, and more urgently: an
  // unvalidated id here is an arbitrary file delete, not an overwrite.
  const jsonlPath = sessionJsonlAbsPath(sessionId, rootOverride);
  const metaPath = sessionMetaAbsPath(sessionId, rootOverride);
  if (jsonlPath === null || metaPath === null) {
    log.warn("session-io", "refused a session id that is not path-safe", { action: "delete session files", length: sessionId.length });
    return;
  }
  await rm(jsonlPath, { force: true });
  await rm(metaPath, { force: true });
}

/** Null for an id that is not path-safe, so a caller cannot come away holding a
 *  path it was never allowed to write to.
 *
 *  Stated as what is PERMITTED rather than as a list of writers to guard,
 *  because the list kept being wrong: three separate reviews of this change
 *  each turned up one more writer deriving a path without checking — the meta
 *  mutators, then `appendSessionLine` / `createSessionMeta`, then
 *  `resultsFilePath`, which `startChat` hands to the tool-trace and jsonl
 *  append sinks. A rule that enumerates bad forms always has one more. */
export function sessionJsonlAbsPath(sessionId: string, rootOverride?: string): string | null {
  const rel = jsonlRel(sessionId);
  return rel === null ? null : resolvePath(root(rootOverride), rel);
}

// .json sidecar to the event-log jsonl. mtime bumps on every writeSessionMeta — used as a "session changed" signal.
// Null on an unsafe id, for the reason on `sessionJsonlAbsPath`.
export function sessionMetaAbsPath(sessionId: string, rootOverride?: string): string | null {
  const rel = metaRel(sessionId);
  return rel === null ? null : resolvePath(root(rootOverride), rel);
}

export async function readSessionJsonl(sessionId: string, rootOverride?: string): Promise<string | null> {
  const rel = jsonlRel(sessionId);
  return rel === null ? null : readTextUnder(root(rootOverride), rel);
}

// Always ends with `\n` to prevent JSONL parse failures from a missing terminator.
export async function appendSessionLine(sessionId: string, line: string, rootOverride?: string): Promise<void> {
  // `startChat` appends with the `chatSessionId` straight off the request body
  // (server/api/routes/agent.ts), which only checks that it is non-empty.
  const rel = jsonlRel(sessionId);
  if (rel === null) {
    refuseUnsafeSessionId(sessionId, "append transcript line");
    return;
  }
  const normalized = line.endsWith("\n") ? line : `${line}\n`;
  await appendFile(resolvePath(root(rootOverride), rel), normalized);
}
