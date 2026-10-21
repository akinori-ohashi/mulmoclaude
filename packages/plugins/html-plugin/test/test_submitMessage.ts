// The submit message is posted by an LLM-authored page, so everything about it is untrusted:
// these pin which shapes reach the confirmation bar and which are dropped.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_SUBMIT_TEXT_CHARS, SUBMIT_MESSAGE_TYPE, readSubmitMessage } from "../src/core/submitMessage";

const frame = { name: "this-frame" };
const otherFrame = { name: "other-frame" };
const message = (data: unknown, source: unknown = frame) => ({ source, data });

describe("readSubmitMessage", () => {
  it("accepts text from this View's own frame", () => {
    assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text: "Option B" }), frame), { kind: "text", text: "Option B" });
  });

  it("keeps the text as sent, including surrounding whitespace and newlines", () => {
    const text = "  - A: yes\n- B: no\n";
    assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text }), frame), { kind: "text", text });
  });

  it("ignores a message from another frame or from no frame", () => {
    const data = { type: SUBMIT_MESSAGE_TYPE, text: "x" };
    assert.deepEqual(readSubmitMessage(message(data, otherFrame), frame), { kind: "ignored" });
    assert.deepEqual(readSubmitMessage(message(data, null), frame), { kind: "ignored" });
  });

  it("ignores everything while the frame window is not known", () => {
    for (const frameWindow of [null, undefined]) {
      assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text: "x" }, frameWindow), frameWindow), { kind: "ignored" });
    }
  });

  it("ignores other message types", () => {
    for (const type of ["mulmo-html-submitted", "", undefined, 1]) {
      assert.deepEqual(readSubmitMessage(message({ type, text: "x" }), frame), { kind: "ignored" });
    }
  });

  it("ignores a missing or non-string text", () => {
    for (const text of [undefined, null, 42, ["a"], { a: 1 }]) {
      assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text }), frame), { kind: "ignored" });
    }
  });

  it("ignores empty and whitespace-only text", () => {
    for (const text of ["", "   ", "\n\t"]) {
      assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text }), frame), { kind: "ignored" });
    }
  });

  it("ignores non-object data", () => {
    for (const data of [null, undefined, SUBMIT_MESSAGE_TYPE, 7, [SUBMIT_MESSAGE_TYPE, "x"]]) {
      assert.deepEqual(readSubmitMessage(message(data), frame), { kind: "ignored" });
    }
  });

  it("accepts text at the limit and reports one character over it", () => {
    const atLimit = "a".repeat(MAX_SUBMIT_TEXT_CHARS);
    assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text: atLimit }), frame), { kind: "text", text: atLimit });
    assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text: `${atLimit}a` }), frame), { kind: "tooLong" });
  });

  it("reports oversized text as too long even when it is all whitespace", () => {
    const blank = " ".repeat(MAX_SUBMIT_TEXT_CHARS + 1);
    assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text: blank }), frame), { kind: "tooLong" });
  });

  it("checks the source before the payload, so another frame's oversized text is ignored rather than reported", () => {
    const tooLong = "a".repeat(MAX_SUBMIT_TEXT_CHARS + 1);
    assert.deepEqual(readSubmitMessage(message({ type: SUBMIT_MESSAGE_TYPE, text: tooLong }, otherFrame), frame), { kind: "ignored" });
  });
});
