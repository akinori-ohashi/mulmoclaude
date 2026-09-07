import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { focusLeftContainer } from "../src/vue/helpers";

/**
 * "Focus actually left the editor" — the moment pending edits have to be written.
 *
 * MulmoTerminal's agent is a terminal, so there is no "message sent" event to hook. What the
 * user always does before asking it for anything is move focus out of the editor, which makes
 * this the reliable point to flush: the agent then reads a file that includes the last
 * keystroke.
 *
 * The distinction that matters is BETWEEN fields versus OUT of the editor. Writing on every hop
 * between inputs would save on each tab press; writing on none would let the user walk away
 * with the last keystroke unsaved.
 */

const dom = new JSDOM(`<!doctype html><body>
  <div id="editor"><input id="a" /><input id="b" /><div id="deep"><input id="c" /></div></div>
  <textarea id="outside"></textarea>
</body>`);
const { document } = dom.window;
// `focusLeftContainer` narrows with `instanceof Node`, which resolves against the global — the
// browser has one, node does not.
Object.defineProperty(globalThis, "Node", { value: dom.window.Node, configurable: true });
const editor = document.querySelector("#editor");
const at = (id: string) => document.querySelector(`#${id}`);

describe("focusLeftContainer", () => {
  it("is not a departure when focus moves to a sibling field inside", () => {
    assert.equal(focusLeftContainer(editor, at("b")), false);
  });

  it("is not a departure when focus moves deeper inside", () => {
    assert.equal(focusLeftContainer(editor, at("c")), false);
  });

  it("is a departure when focus moves to something outside", () => {
    assert.equal(focusLeftContainer(editor, at("outside")), true);
  });

  it("is a departure when focus goes nowhere the document can name", () => {
    // Clicking page chrome, or the window losing focus: the editor is no longer where the
    // typing goes, so the edit has to be written.
    assert.equal(focusLeftContainer(editor, null), true);
  });

  it("does nothing when there is no container to leave", () => {
    assert.equal(focusLeftContainer(null, at("outside")), false);
  });

  it("treats the container itself as inside", () => {
    // A container that takes focus directly (tabindex) has not been left.
    assert.equal(focusLeftContainer(editor, editor), false);
  });
});
