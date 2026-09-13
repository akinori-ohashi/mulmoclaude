import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChatModel } from "../../src/config/chatModelSource.js";
import { CHAT_MODELS } from "../../src/config/models.js";

// #3104. The cascade is one line, but the SOURCE is the part that matters:
// #2923 existed because the model changed and nothing said so, and adding a
// second place a model can come from recreates that invisibility unless the
// answer says which place won.

describe("resolveChatModel", () => {
  it("lets the role win over the app-wide setting", () => {
    assert.deepEqual(resolveChatModel("haiku", "opus"), { model: "haiku", source: "role" });
  });

  it("falls back to the app-wide setting when the role says nothing", () => {
    assert.deepEqual(resolveChatModel(undefined, "opus"), { model: "opus", source: "global" });
  });

  // The case the whole feature is about: no model is passed to the CLI, which
  // then resolves from ~/.claude/settings.json — a file other Claude Code
  // clients write to. `model` is undefined because at this layer the value
  // genuinely is not known; only the CLI's init frame can report it (#2554).
  it("reports `shared` with NO model when neither decides", () => {
    assert.deepEqual(resolveChatModel(undefined, undefined), { source: "shared" });
    assert.equal(resolveChatModel(undefined, undefined).model, undefined);
  });

  it("uses the role even when the app-wide setting is unset", () => {
    assert.deepEqual(resolveChatModel("sonnet", undefined), { model: "sonnet", source: "role" });
  });

  it("never invents a model", () => {
    const shared = resolveChatModel(undefined, undefined);
    assert.equal("model" in shared, false);
  });

  // Iterates CHAT_MODELS rather than restating it: an alias added to the single
  // source must be covered here automatically, which a literal list would not do.
  it("is the same answer for every alias, so no family is special-cased", () => {
    CHAT_MODELS.forEach((model) => {
      assert.deepEqual(resolveChatModel(model, undefined), { model, source: "role" });
      assert.deepEqual(resolveChatModel(undefined, model), { model, source: "global" });
    });
  });
});
