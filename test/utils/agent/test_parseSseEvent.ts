// Every agent event now goes through `parseSseEvent` before it reaches the
// dispatcher, so a field this parser rejects is an event that never renders.
// One happy case per SSE variant plus the rejection paths.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSseEvent } from "../../../src/utils/agent/parseSseEvent.js";
import { EVENT_TYPES } from "../../../src/types/events.js";

describe("parseSseEvent — accepted variants", () => {
  it("keeps status / error / rolesUpdated / sessionFinished", () => {
    assert.deepEqual(parseSseEvent({ type: EVENT_TYPES.status, message: "working" }), { type: EVENT_TYPES.status, message: "working" });
    assert.deepEqual(parseSseEvent({ type: EVENT_TYPES.error, message: "boom" }), { type: EVENT_TYPES.error, message: "boom" });
    assert.deepEqual(parseSseEvent({ type: EVENT_TYPES.rolesUpdated }), { type: EVENT_TYPES.rolesUpdated });
    assert.deepEqual(parseSseEvent({ type: EVENT_TYPES.sessionFinished }), { type: EVENT_TYPES.sessionFinished });
  });

  it("keeps tool_call with its opaque args", () => {
    const event = { type: EVENT_TYPES.toolCall, toolUseId: "tu_1", toolName: "Read", args: { file: "a.md" } };
    assert.deepEqual(parseSseEvent(event), event);
  });

  it("keeps tool_call_result including the isError flag", () => {
    const event = { type: EVENT_TYPES.toolCallResult, toolUseId: "tu_1", content: "nope", isError: true };
    assert.deepEqual(parseSseEvent(event), event);
    assert.deepEqual(parseSseEvent({ type: EVENT_TYPES.toolCallResult, toolUseId: "tu_1", content: "ok" }), {
      type: EVENT_TYPES.toolCallResult,
      toolUseId: "tu_1",
      content: "ok",
      isError: undefined,
    });
  });

  it("keeps text with source and both attachment shapes", () => {
    const parsed = parseSseEvent({
      type: EVENT_TYPES.text,
      message: "hi",
      source: "user",
      attachments: ["legacy/path.png", { path: "new/path.png", filename: "photo.png" }],
    });
    assert.deepEqual(parsed, {
      type: EVENT_TYPES.text,
      message: "hi",
      source: "user",
      attachments: ["legacy/path.png", { path: "new/path.png", filename: "photo.png" }],
    });
  });

  it("keeps skill events with a null path / description", () => {
    const event = {
      type: EVENT_TYPES.skill,
      source: "assistant",
      skillName: "mc-library",
      skillScope: "project",
      skillPath: null,
      skillDescription: null,
      message: "body",
    };
    assert.deepEqual(parseSseEvent(event), event);
  });

  it("keeps a plugin skill event", () => {
    // The scope guard is the only thing standing between a plugin skill's card
    // and being dropped client-side: `parseSseEvent` returning null makes the
    // event vanish silently, so this pins `claude-plugin` as accepted.
    const event = {
      type: EVENT_TYPES.skill,
      source: "assistant",
      skillName: "demo:story",
      skillScope: "claude-plugin",
      skillPath: "/plugins/demo/skills/story/SKILL.md",
      skillDescription: "Tell a story",
      message: "body",
    };
    assert.deepEqual(parseSseEvent(event), event);
  });

  it("drops a skill event whose scope is not one we know", () => {
    const event = {
      type: EVENT_TYPES.skill,
      source: "assistant",
      skillName: "demo:story",
      skillScope: "plugin",
      skillPath: null,
      skillDescription: null,
      message: "body",
    };
    assert.equal(parseSseEvent(event), null);
  });

  it("keeps generation_started / generation_finished", () => {
    const started = { type: EVENT_TYPES.generationStarted, kind: "beatImage", filePath: "a.json", key: "0" };
    assert.deepEqual(parseSseEvent(started), started);
    const finished = { type: EVENT_TYPES.generationFinished, kind: "movie", filePath: "a.json", key: "", error: "failed" };
    assert.deepEqual(parseSseEvent(finished), finished);
  });
});

describe("parseSseEvent — tool_result", () => {
  it("preserves undeclared fields the host reads (e.g. `action`)", () => {
    const parsed = parseSseEvent({
      type: EVENT_TYPES.toolResult,
      result: { toolName: "manageWiki", uuid: "u1", message: "done", action: "page", data: { slug: "home" } },
    });
    assert.deepEqual(parsed, {
      type: EVENT_TYPES.toolResult,
      result: { toolName: "manageWiki", uuid: "u1", message: "done", action: "page", data: { slug: "home" } },
    });
  });

  it("defaults a missing message to the empty string", () => {
    const parsed = parseSseEvent({ type: EVENT_TYPES.toolResult, result: { toolName: "x", uuid: "u2" } });
    assert.deepEqual(parsed, { type: EVENT_TYPES.toolResult, result: { toolName: "x", uuid: "u2", message: "" } });
  });

  it("rejects a result without the required identifiers", () => {
    assert.equal(parseSseEvent({ type: EVENT_TYPES.toolResult, result: { uuid: "u3" } }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.toolResult, result: { toolName: "x" } }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.toolResult, result: "not-an-object" }), null);
  });

  it("rejects a result whose declared field has the wrong type", () => {
    assert.equal(parseSseEvent({ type: EVENT_TYPES.toolResult, result: { toolName: "x", uuid: "u", title: 7 } }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.toolResult, result: { toolName: "x", uuid: "u", updating: "yes" } }), null);
  });
});

describe("parseSseEvent — rejections", () => {
  it("rejects non-records and unknown event types", () => {
    assert.equal(parseSseEvent(null), null);
    assert.equal(parseSseEvent("text"), null);
    assert.equal(parseSseEvent([{ type: EVENT_TYPES.status, message: "x" }]), null);
    assert.equal(parseSseEvent({ type: "who_knows" }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.claudeSessionId, sessionId: "s" }), null);
  });

  it("rejects variants missing a required payload field", () => {
    assert.equal(parseSseEvent({ type: EVENT_TYPES.status }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.toolCall, toolUseId: "tu" }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.toolCallResult, toolUseId: "tu" }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.text, message: 42 }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.text, message: "hi", source: "system" }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.skill, source: "user", skillName: "s", message: "m" }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.generationStarted, kind: "unknownKind", filePath: "a", key: "" }), null);
  });

  // #2554: this parser is a whitelist with `default: return null`, so an event
  // type the server starts broadcasting is DROPPED here until a case exists —
  // silently, with the server-side write still succeeding. That is exactly how
  // the live model chip failed its first end-to-end run: the value reached
  // session meta on disk and never reached the screen.
  it("narrows a session_meta delta carrying the resolved model", () => {
    assert.deepEqual(parseSseEvent({ type: EVENT_TYPES.sessionMeta, resolvedModel: "claude-haiku-4-5-20251001" }), {
      type: EVENT_TYPES.sessionMeta,
      resolvedModel: "claude-haiku-4-5-20251001",
    });
  });

  it("drops a session_meta event with nothing usable in it", () => {
    assert.equal(parseSseEvent({ type: EVENT_TYPES.sessionMeta }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.sessionMeta, resolvedModel: "" }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.sessionMeta, resolvedModel: 42 }), null);
    assert.equal(parseSseEvent({ type: EVENT_TYPES.sessionMeta, resolvedModel: null }), null);
  });

  it("drops a malformed attachment list rather than half of it", () => {
    const parsed = parseSseEvent({ type: EVENT_TYPES.text, message: "hi", attachments: ["ok", { filename: "no-path.png" }] });
    assert.deepEqual(parsed, { type: EVENT_TYPES.text, message: "hi", source: undefined, attachments: undefined });
  });
});
