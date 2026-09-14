import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAT_MODELS, EFFORT_LEVELS } from "../../src/config/models.js";

// Every other test that touches these lists ITERATES them, so it agrees with
// whatever they happen to contain — a value mistyped while editing the list
// would keep the whole suite green and ship a picker option the CLI rejects
// at spawn ("isn't described by this version's model catalog"). These two
// assertions are the only place the literal contents are pinned, so a change
// has to be deliberate.
//
// Adding an entry means editing this test too. Before you do: confirm the CLI
// actually accepts it, rather than trusting the help text —
//   claude --model <alias> -p "Reply with exactly: OK"
// answers "OK" for a real alias and errors for an unknown one.

describe("CHAT_MODELS", () => {
  it("is exactly the aliases verified against the CLI", () => {
    assert.deepEqual([...CHAT_MODELS], ["fable", "opus", "sonnet", "haiku"]);
  });

  it("holds family aliases only — a pinned id would strand users on a retired model", () => {
    CHAT_MODELS.forEach((model) => {
      assert.ok(/^[a-z]+$/.test(model), `${model} must be a bare family alias (no version, no suffix)`);
    });
  });
});

describe("EFFORT_LEVELS", () => {
  it("is exactly the levels `claude --effort` accepts", () => {
    assert.deepEqual([...EFFORT_LEVELS], ["low", "medium", "high", "xhigh", "max"]);
  });
});
