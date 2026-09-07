import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SCRIPT_CHANGED_EVENT, shouldReloadForScriptChange } from "../src/core/contract";

/**
 * "Someone else wrote this script" — the signal that lets an agent's edit appear without the
 * user reopening the canvas.
 *
 * The rule that carries the weight is the ECHO: a View's own save comes back on the same
 * channel, and acting on it would rebuild the element the caret is in on every keystroke. So a
 * View tags each write with its own origin and drops what comes back carrying it.
 */

const MINE = "deck-editor-aaa";
const PATH = "stories/deck.json";

describe("script-changed filtering", () => {
  it("reloads for a write with no origin — that is the agent", () => {
    assert.equal(shouldReloadForScriptChange({ filePath: PATH }, PATH, MINE), true);
  });

  it("ignores the echo of this editor's own write", () => {
    // Without this the caret's own element is rebuilt mid-keystroke.
    assert.equal(shouldReloadForScriptChange({ filePath: PATH, origin: MINE }, PATH, MINE), false);
  });

  it("reloads for another window editing the same file", () => {
    assert.equal(shouldReloadForScriptChange({ filePath: PATH, origin: "deck-editor-bbb" }, PATH, MINE), true);
  });

  it("ignores a write to a different script", () => {
    assert.equal(shouldReloadForScriptChange({ filePath: "stories/other.json" }, PATH, MINE), false);
  });

  it("ignores everything while no script is open", () => {
    assert.equal(shouldReloadForScriptChange({ filePath: PATH }, "", MINE), false);
  });

  it("names the channel, which the host and the View have to agree on", () => {
    assert.equal(SCRIPT_CHANGED_EVENT, "scriptChanged");
  });
});
