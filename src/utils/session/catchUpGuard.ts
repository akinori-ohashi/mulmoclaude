// Whether a catch-up snapshot may replace the client's transcript. Adopting is
// only safe when the snapshot is both complete and current:
//
// - complete: while a turn runs, the server has not yet written the text still
//   streaming (its accumulator is flushed by the next non-text event or at run
//   end), so a mid-run snapshot is missing the card the user is watching. The
//   server says so in the snapshot itself; the client's own `isRunning` only
//   mirrors the session list and can lag, so either one saying "running" wins
//   (#3294).
// - current: live events that arrived while the fetch was in flight are not in
//   the snapshot; adopting it would drop them until the next refresh (#3295).

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SessionEntry } from "../../types/session";
import { EVENT_TYPES } from "../../types/events";
import { isRecord } from "../types";
import { shouldAdoptServerTranscript } from "./sessionEntries";

/** What the transcript looked like when the fetch started: each card, and each
 *  of its own property values, held by reference. Every live change replaces a
 *  card, or assigns one of its properties (a streamed `message`, `data` or any
 *  other field through `Object.assign`), so comparing them catches it without
 *  listing fields or having every mutation site keep a counter. */
export interface TranscriptSnapshot {
  cards: ToolResultComplete[];
  values: unknown[][];
}

function propertyValues(card: ToolResultComplete): unknown[] {
  if (!isRecord(card)) return [];
  return Object.keys(card)
    .sort()
    .flatMap((key): unknown[] => [key, card[key]]);
}

export function captureTranscript(toolResults: readonly ToolResultComplete[]): TranscriptSnapshot {
  return { cards: [...toolResults], values: toolResults.map(propertyValues) };
}

function sameValues(before: unknown[] | undefined, after: unknown[]): boolean {
  return before !== undefined && before.length === after.length && after.every((value, index) => value === before[index]);
}

export function transcriptChangedSince(snapshot: TranscriptSnapshot, toolResults: readonly ToolResultComplete[]): boolean {
  if (snapshot.cards.length !== toolResults.length) return true;
  return toolResults.some((card, index) => card !== snapshot.cards[index] || !sameValues(snapshot.values[index], propertyValues(card)));
}

function sessionMetaRow(entries: readonly SessionEntry[]): SessionEntry | undefined {
  return entries.find((entry) => entry.type === EVENT_TYPES.sessionMeta);
}

/** The server marks a snapshot that a run may have been writing to while it was
 *  read. A response without the flag (an older server) counts as complete. */
export function snapshotMayBeIncomplete(entries: readonly SessionEntry[]): boolean {
  const meta = sessionMetaRow(entries);
  return isRecord(meta) && meta.snapshotMayBeIncomplete === true;
}

export type CatchUpDecision = "adopt" | "running" | "stale" | "not-richer";

export interface CatchUpState {
  clientRunning: boolean;
  snapshotIncomplete: boolean;
  snapshotAtFetch: TranscriptSnapshot;
  clientResults: readonly ToolResultComplete[];
  serverResults: readonly ToolResultComplete[];
}

export function decideCatchUpAdoption(state: CatchUpState): CatchUpDecision {
  if (state.clientRunning || state.snapshotIncomplete) return "running";
  if (transcriptChangedSince(state.snapshotAtFetch, state.clientResults)) return "stale";
  return shouldAdoptServerTranscript(state.serverResults, state.clientResults) ? "adopt" : "not-richer";
}
