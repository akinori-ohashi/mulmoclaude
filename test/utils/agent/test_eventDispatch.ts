import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addPendingGeneration, applyAgentEvent, removePendingGeneration } from "../../../src/utils/agent/eventDispatch.js";
import { generationKey, type PendingGeneration, GENERATION_KINDS } from "@mulmobridge/protocol";
import type { SseGenerationStarted, SseGenerationFinished, SseSessionMeta } from "../../../src/types/sse.js";
import type { ActiveSession } from "../../../src/types/session.js";
import { EVENT_TYPES } from "../../../src/types/events.js";

const kind = GENERATION_KINDS.beatImage;

const started = (filePath: string, key: string): SseGenerationStarted => ({
  type: EVENT_TYPES.generationStarted,
  kind,
  filePath,
  key,
});

const finished = (filePath: string, key: string): SseGenerationFinished => ({
  type: EVENT_TYPES.generationFinished,
  kind,
  filePath,
  key,
});

describe("addPendingGeneration", () => {
  it("stores the decomposed generation under its stable key", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    assert.deepEqual(pending[generationKey(kind, "a.png", "k1")], { kind, filePath: "a.png", key: "k1" });
  });

  it("keeps distinct generations side by side", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    addPendingGeneration(pending, started("b.png", "k2"));
    assert.equal(Object.keys(pending).length, 2);
  });

  it("overwrites the same key idempotently", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    addPendingGeneration(pending, started("a.png", "k1"));
    assert.equal(Object.keys(pending).length, 1);
  });
});

describe("removePendingGeneration", () => {
  it("removes the matching entry and reports the map is now empty", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    const isEmpty = removePendingGeneration(pending, finished("a.png", "k1"));
    assert.equal(isEmpty, true);
    assert.equal(Object.keys(pending).length, 0);
  });

  it("reports not-empty while other generations remain", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    addPendingGeneration(pending, started("b.png", "k2"));
    const isEmpty = removePendingGeneration(pending, finished("a.png", "k1"));
    assert.equal(isEmpty, false);
    assert.equal(Object.keys(pending).length, 1);
  });

  it("treats removing from an already-empty map as empty", () => {
    const pending: Record<string, PendingGeneration> = {};
    assert.equal(removePendingGeneration(pending, finished("a.png", "k1")), true);
  });

  it("reports not-empty when the removed key was absent but others exist", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    assert.equal(removePendingGeneration(pending, finished("missing.png", "kX")), false);
    assert.equal(Object.keys(pending).length, 1);
  });
});

// #2554 / Codex round 1: the LIVE half of the model chip. A `session_meta`
// delta arriving mid-turn has to land on the session, or the chip only ever
// appears after a reload — which is exactly how this shipped broken once
// during development, with the value correct on disk and absent on screen.
describe("applyAgentEvent — session_meta", () => {
  const session = (): ActiveSession =>
    ({
      id: "s1",
      roleId: "general",
      toolResults: [],
      resultTimestamps: new Map(),
      isRunning: false,
      statusMessage: "",
      toolCallHistory: [],
      selectedResultUuid: null,
      hasUnread: false,
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      runStartIndex: 0,
      assistantTextInterrupted: false,
      pendingGenerations: {},
    }) as ActiveSession;

  const ctx = (active: ActiveSession) => ({
    session: active,
    refreshRoles: async () => {},
    scrollSidebarToBottom: () => {},
    onGenerationsDrained: () => {},
  });

  const metaEvent = (resolvedModel?: string): SseSessionMeta => ({ type: EVENT_TYPES.sessionMeta, resolvedModel });

  it("applies the resolved model to the live session", async () => {
    const active = session();
    await applyAgentEvent(metaEvent("claude-haiku-4-5-20251001"), ctx(active));
    assert.equal(active.resolvedModel, "claude-haiku-4-5-20251001");
  });

  it("overwrites a model the session already had", async () => {
    const active = session();
    active.resolvedModel = "claude-sonnet-5";
    await applyAgentEvent(metaEvent("claude-opus-5[1m]"), ctx(active));
    assert.equal(active.resolvedModel, "claude-opus-5[1m]");
  });

  // The event is a DELTA. One that carries nothing must not blank a model the
  // session already knows — that would flicker the chip off mid-conversation.
  it("leaves an existing model alone when the delta carries none", async () => {
    const active = session();
    active.resolvedModel = "claude-sonnet-5";
    await applyAgentEvent(metaEvent(undefined), ctx(active));
    assert.equal(active.resolvedModel, "claude-sonnet-5");
  });

  it("does not disturb the rest of the session", async () => {
    const active = session();
    await applyAgentEvent(metaEvent("claude-sonnet-5"), ctx(active));
    assert.deepEqual(active.toolResults, []);
    assert.deepEqual(active.toolCallHistory, []);
    assert.equal(active.statusMessage, "");
    assert.equal(active.roleId, "general");
  });
});
