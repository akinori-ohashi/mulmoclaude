import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRequireMention, shouldRespond } from "../src/groupGate.js";

describe("parseRequireMention", () => {
  it("defaults to on", () => {
    [undefined, "", " ", "1", "true", "TRUE", " 1 "].forEach((raw) => assert.equal(parseRequireMention(raw), true));
  });

  it("turns off with 0 / false", () => {
    ["0", "false", "False", " 0 "].forEach((raw) => assert.equal(parseRequireMention(raw), false));
  });

  it("throws on anything else", () => {
    ["yes", "no", "2", "off", "on", "01"].forEach((raw) => assert.throws(() => parseRequireMention(raw), /LINE_BRIDGE_GROUP_REQUIRE_MENTION/));
  });
});

describe("shouldRespond", () => {
  it("always answers one-on-one", () => {
    [true, false].forEach((requireMention) =>
      [true, false].forEach((mentioned) => assert.equal(shouldRespond({ chatType: "user", mentionsBot: mentioned }, requireMention), true)),
    );
  });

  it("answers a group / room only when mentioned while the gate is on", () => {
    (["group", "room"] as const).forEach((chatType) => {
      assert.equal(shouldRespond({ chatType, mentionsBot: true }, true), true);
      assert.equal(shouldRespond({ chatType, mentionsBot: false }, true), false);
    });
  });

  it("answers every group / room message while the gate is off", () => {
    (["group", "room"] as const).forEach((chatType) => {
      assert.equal(shouldRespond({ chatType, mentionsBot: false }, false), true);
      assert.equal(shouldRespond({ chatType, mentionsBot: true }, false), true);
    });
  });
});
