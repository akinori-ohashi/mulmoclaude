// Adopting the server's transcript after a reconnect catch-up (#2096) replaces
// the card list, but text / skill / error cards get a fresh uuid on every
// parse. Swapping the list alone therefore orphans every text card's timestamp
// and can leave the selection pointing at a uuid that no longer exists (#3292).
// This carries both across by aligning the server cards to the client's.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { SKILL_TOOL_NAME, TEXT_LIKE_RESULT_TOOL_NAMES } from "../tools/result";
import { isRecord } from "../types";

export interface TranscriptView {
  toolResults: ToolResultComplete[];
  selectedResultUuid: string | null;
  resultTimestamps: Map<string, number>;
}

/** What a text-like card says. A skill card's `message` is only its
 *  description; the streamed body lives in `data.body`. */
function cardBody(card: ToolResultComplete): string {
  if (card.toolName === SKILL_TOOL_NAME && isRecord(card.data) && typeof card.data.body === "string") return card.data.body;
  return card.message ?? "";
}

function isSameTextKind(clientCard: ToolResultComplete, serverCard: ToolResultComplete): boolean {
  return TEXT_LIKE_RESULT_TOOL_NAMES.has(serverCard.toolName) && clientCard.toolName === serverCard.toolName && clientCard.title === serverCard.title;
}

/** The same card: identical uuid (tool results keep theirs across the round
 *  trip), or the same kind of text card saying exactly the same thing. */
function isSameCard(clientCard: ToolResultComplete, serverCard: ToolResultComplete): boolean {
  return clientCard.uuid === serverCard.uuid || (isSameTextKind(clientCard, serverCard) && cardBody(clientCard) === cardBody(serverCard));
}

/** A dropped frame can only truncate the card still streaming — the client's
 *  last one — so only that card may match a server card that extends it. */
function isContinuation(clientCard: ToolResultComplete, serverCard: ToolResultComplete): boolean {
  return isSameTextKind(clientCard, serverCard) && cardBody(serverCard).startsWith(cardBody(clientCard));
}

/** The truncated tail's continuation, only when exactly one server card could
 *  be it — an ambiguous tail stays unmatched rather than take a wrong identity. */
function findContinuation(clientCard: ToolResultComplete | undefined, serverResults: readonly ToolResultComplete[]): number {
  if (clientCard === undefined) return -1;
  const candidates = serverResults.map((serverCard, index) => (isContinuation(clientCard, serverCard) ? index : -1)).filter((index) => index !== -1);
  return candidates.length === 1 ? (candidates[0] ?? -1) : -1;
}

// An exact match outweighs a continuation, so a truncated tail never wins a
// server card that some client card matches exactly.
const EXACT_MATCH_WEIGHT = 2;
const CONTINUATION_WEIGHT = 1;
// The table is (client + 1) × (server + 1) cells after the shared prefix is
// trimmed; past this the remainder is left unaligned (timestamps fall back to
// the adoption time) rather than allocate an unbounded table.
const MAX_ALIGNMENT_CELLS = 4_000_000;

interface AlignmentInput {
  client: readonly ToolResultComplete[];
  server: readonly ToolResultComplete[];
  tailContinuation: number;
}

function matchWeight(input: AlignmentInput, clientIndex: number, serverIndex: number): number {
  const clientCard = input.client[clientIndex];
  const serverCard = input.server[serverIndex];
  if (clientCard === undefined || serverCard === undefined) return 0;
  if (isSameCard(clientCard, serverCard)) return EXACT_MATCH_WEIGHT;
  const isTail = clientIndex === input.client.length - 1;
  return isTail && serverIndex === input.tailContinuation ? CONTINUATION_WEIGHT : 0;
}

/** Best total weight aligning client[i..] with server[j..], at i * (m + 1) + j. */
function buildScoreTable(input: AlignmentInput): Int32Array {
  const width = input.server.length + 1;
  const table = new Int32Array((input.client.length + 1) * width);
  for (let clientIndex = input.client.length - 1; clientIndex >= 0; clientIndex -= 1) {
    for (let serverIndex = input.server.length - 1; serverIndex >= 0; serverIndex -= 1) {
      const weight = matchWeight(input, clientIndex, serverIndex);
      const skipClient = table[(clientIndex + 1) * width + serverIndex] ?? 0;
      const skipServer = table[clientIndex * width + serverIndex + 1] ?? 0;
      const matched = weight > 0 ? weight + (table[(clientIndex + 1) * width + serverIndex + 1] ?? 0) : 0;
      table[clientIndex * width + serverIndex] = Math.max(skipClient, skipServer, matched);
    }
  }
  return table;
}

/** Walk the table forward, taking a match whenever it is on an optimal path. */
function traceMatches(input: AlignmentInput, table: Int32Array): [number, number][] {
  const width = input.server.length + 1;
  const matches: [number, number][] = [];
  let clientIndex = 0;
  let serverIndex = 0;
  while (clientIndex < input.client.length && serverIndex < input.server.length) {
    const here = table[clientIndex * width + serverIndex] ?? 0;
    const weight = matchWeight(input, clientIndex, serverIndex);
    if (weight > 0 && here === weight + (table[(clientIndex + 1) * width + serverIndex + 1] ?? 0)) {
      matches.push([clientIndex, serverIndex]);
      serverIndex += 1;
      clientIndex += 1;
    } else if (here === (table[(clientIndex + 1) * width + serverIndex] ?? 0)) clientIndex += 1;
    else serverIndex += 1;
  }
  return matches;
}

function sharedPrefixLength(clientResults: readonly ToolResultComplete[], serverResults: readonly ToolResultComplete[]): number {
  const firstDifference = clientResults.findIndex((clientCard, index) => {
    const serverCard = serverResults[index];
    return serverCard === undefined || !isSameCard(clientCard, serverCard);
  });
  return firstDifference === -1 ? clientResults.length : firstDifference;
}

/** Server uuid → the client uuid it continues: the order-preserving alignment
 *  with the most matched cards. Server cards left over are ones the client
 *  missed; client cards left over (a local-only error) are simply dropped. */
export function alignServerToClient(clientResults: readonly ToolResultComplete[], serverResults: readonly ToolResultComplete[]): Map<string, string> {
  const prefix = sharedPrefixLength(clientResults, serverResults);
  const serverToClient = new Map<string, string>(
    clientResults.slice(0, prefix).map((clientCard, index): [string, string] => [serverResults[index]?.uuid ?? "", clientCard.uuid]),
  );
  const client = clientResults.slice(prefix);
  const server = serverResults.slice(prefix);
  if ((client.length + 1) * (server.length + 1) > MAX_ALIGNMENT_CELLS) return serverToClient;
  const input: AlignmentInput = { client, server, tailContinuation: findContinuation(client[client.length - 1], server) };
  traceMatches(input, buildScoreTable(input)).forEach(([clientIndex, serverIndex]) => {
    const serverCard = server[serverIndex];
    const clientCard = client[clientIndex];
    if (serverCard !== undefined && clientCard !== undefined) serverToClient.set(serverCard.uuid, clientCard.uuid);
  });
  return serverToClient;
}

/** Where the selection lands: a user parked on the last card keeps following
 *  the conversation; any other choice is kept, on its new uuid; a selection
 *  whose card is gone falls back to the last card. */
function resolveAdoptedSelection(client: TranscriptView, serverResults: readonly ToolResultComplete[], serverToClient: Map<string, string>): string | null {
  const lastServerUuid = serverResults[serverResults.length - 1]?.uuid ?? null;
  const selected = client.selectedResultUuid;
  if (selected === null || selected === client.toolResults[client.toolResults.length - 1]?.uuid) return lastServerUuid;
  const match = serverResults.find((serverCard) => serverToClient.get(serverCard.uuid) === selected);
  return match?.uuid ?? lastServerUuid;
}

export function adoptServerTranscript(client: TranscriptView, serverResults: ToolResultComplete[], nowMs: number): TranscriptView {
  const serverToClient = alignServerToClient(client.toolResults, serverResults);
  const resultTimestamps = new Map<string, number>();
  serverResults.forEach((serverCard) => {
    const clientUuid = serverToClient.get(serverCard.uuid);
    const carried = clientUuid === undefined ? undefined : client.resultTimestamps.get(clientUuid);
    resultTimestamps.set(serverCard.uuid, carried ?? nowMs);
  });
  return {
    toolResults: serverResults,
    selectedResultUuid: resolveAdoptedSelection(client, serverResults, serverToClient),
    resultTimestamps,
  };
}
