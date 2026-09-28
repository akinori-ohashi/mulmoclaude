// #3294 / #3295. A catch-up snapshot may replace the transcript only when it
// is complete (no run in progress, by either side's account) and current
// (nothing changed while it was being fetched).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SessionEntry } from "../../../src/types/session.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import {
  captureTranscript,
  decideCatchUpAdoption,
  snapshotMayBeIncomplete,
  transcriptChangedSince,
  type CatchUpState,
} from "../../../src/utils/session/catchUpGuard.js";
import { makeErrorResult, makeTextResult } from "../../../src/utils/tools/result.js";
import { appendToLastAssistantText, applyToolResultToSession, updateResult } from "../../../src/utils/session/sessionHelpers.js";
import { createEmptySession } from "../../../src/utils/session/sessionFactory.js";

function chart(uuid: string, title: string): ToolResultComplete {
  return { uuid, toolName: "presentChart", message: "chart", title, data: { series: [1] } };
}

function richerServerCopy(): ToolResultComplete[] {
  return [makeTextResult("hi", "user"), makeTextResult("hello", "assistant"), makeErrorResult("missed")];
}

function baseState(clientResults: ToolResultComplete[]): CatchUpState {
  return {
    clientRunning: false,
    snapshotIncomplete: false,
    snapshotAtFetch: captureTranscript(clientResults),
    clientResults,
    serverResults: richerServerCopy(),
  };
}

describe("transcriptChangedSince — every live mutation path is seen", () => {
  function sessionWith(results: ToolResultComplete[]) {
    const session = createEmptySession("s1", "general");
    session.toolResults = results;
    return session;
  }

  it("is unchanged when nothing happened", () => {
    const session = sessionWith([makeTextResult("hi", "user"), chart("c1", "Chart")]);
    assert.equal(transcriptChangedSince(captureTranscript(session.toolResults), session.toolResults), false);
  });

  it("sees a streamed delta appended to the last reply", () => {
    const session = sessionWith([makeTextResult("hi", "user"), makeTextResult("hel", "assistant")]);
    const snapshot = captureTranscript(session.toolResults);
    assert.equal(appendToLastAssistantText(session, "lo"), true);
    assert.equal(transcriptChangedSince(snapshot, session.toolResults), true);
  });

  it("sees an in-place update of a card that is not the last (updateResult)", () => {
    const session = sessionWith([chart("c1", "Chart"), makeTextResult("after", "assistant")]);
    const snapshot = captureTranscript(session.toolResults);
    updateResult(session, { ...chart("c1", "Chart"), data: { series: [2] } });
    assert.equal(transcriptChangedSince(snapshot, session.toolResults), true);
  });

  it("sees a card replaced in its slot (applyToolResultToSession)", () => {
    const session = sessionWith([chart("c1", "Chart"), makeTextResult("after", "assistant")]);
    const snapshot = captureTranscript(session.toolResults);
    applyToolResultToSession(session, chart("c1", "Chart"));
    assert.equal(transcriptChangedSince(snapshot, session.toolResults), true);
  });

  it("sees any other field assigned onto the same card (e.g. a new title)", () => {
    const session = sessionWith([chart("c1", "Chart"), makeTextResult("after", "assistant")]);
    const snapshot = captureTranscript(session.toolResults);
    const [existing] = session.toolResults;
    assert.ok(existing);
    updateResult(session, { ...existing, title: "Renamed" });
    assert.equal(transcriptChangedSince(snapshot, session.toolResults), true);
  });

  it("sees a card added or removed", () => {
    const results = [makeTextResult("hi", "user")];
    const snapshot = captureTranscript(results);
    assert.equal(transcriptChangedSince(snapshot, [...results, makeErrorResult("x")]), true);
    assert.equal(transcriptChangedSince(snapshot, []), true);
  });

  it("handles an empty transcript", () => {
    assert.equal(transcriptChangedSince(captureTranscript([]), []), false);
  });
});

describe("snapshotMayBeIncomplete", () => {
  const meta = (fields: Record<string, unknown>): SessionEntry => ({ type: EVENT_TYPES.sessionMeta, ...fields }) as SessionEntry;

  it("reads the server's flag off the session_meta row, independent of isRunning", () => {
    assert.equal(snapshotMayBeIncomplete([meta({ snapshotMayBeIncomplete: true, isRunning: false })]), true);
    assert.equal(snapshotMayBeIncomplete([meta({ snapshotMayBeIncomplete: false, isRunning: true })]), false);
  });

  it("treats a missing row, a missing flag or a non-boolean flag as complete", () => {
    [[], [meta({ roleId: "general" })], [meta({ snapshotMayBeIncomplete: "yes" })], [{ source: "user", type: EVENT_TYPES.text, message: "hi" }]].forEach(
      (entries) => {
        assert.equal(snapshotMayBeIncomplete(entries as SessionEntry[]), false);
      },
    );
  });
});

describe("decideCatchUpAdoption", () => {
  it("adopts a richer, current snapshot of a finished session", () => {
    assert.equal(decideCatchUpAdoption(baseState([makeTextResult("hi", "user")])), "adopt");
  });

  it("does not adopt while the client knows a run is in progress", () => {
    assert.equal(decideCatchUpAdoption({ ...baseState([makeTextResult("hi", "user")]), clientRunning: true }), "running");
  });

  it("does not adopt a snapshot the server says may be incomplete, even when the client has not heard of the run", () => {
    assert.equal(decideCatchUpAdoption({ ...baseState([makeTextResult("hi", "user")]), snapshotIncomplete: true }), "running");
  });

  it("rejects a snapshot overtaken by a live change during the fetch", () => {
    const state = baseState([makeTextResult("hi", "user")]);
    assert.equal(decideCatchUpAdoption({ ...state, clientResults: [...state.clientResults, makeTextResult("live", "assistant")] }), "stale");
  });

  it("keeps the client copy when the snapshot is not richer", () => {
    const clientResults = [makeTextResult("hi", "user"), makeTextResult("hello", "assistant")];
    assert.equal(decideCatchUpAdoption({ ...baseState(clientResults), serverResults: [makeTextResult("hi", "user")] }), "not-richer");
  });

  it("reports running before staleness", () => {
    const state = baseState([makeTextResult("hi", "user")]);
    assert.equal(decideCatchUpAdoption({ ...state, snapshotIncomplete: true, clientResults: [] }), "running");
  });

  it("handles an empty client and an empty server", () => {
    assert.equal(decideCatchUpAdoption({ ...baseState([]), serverResults: [] }), "not-richer");
  });
});
