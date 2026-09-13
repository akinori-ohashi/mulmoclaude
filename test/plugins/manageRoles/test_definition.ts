import { describe, it } from "node:test";
import assert from "node:assert/strict";
import definition from "../../../src/plugins/manageRoles/definition.js";
import { CHAT_MODELS } from "../../../src/config/models.js";
import { isRecord } from "../../../src/utils/types.js";

// #3130 collapsed the model alias list to ONE definition, and #3104 then had a
// chance to undo that in the least visible place: the description string this
// MCP tool hands the agent. A list there cannot import CHAT_MODELS — the file
// is a static object evaluated at import time — so it would be a copy that goes
// stale in silence, and the agent would write a value `RoleSchema` drops.
//
// This test reads the ASSEMBLED description rather than grepping the source,
// because a description built by concatenation is a string only at runtime.

const modelDescription = (): string => {
  const { parameters: params } = definition;
  assert.ok(isRecord(params), "parameters must be an object");
  const { properties: props } = params;
  assert.ok(isRecord(props), "parameters.properties must be an object");
  const { role } = props;
  assert.ok(isRecord(role), "role property must be an object");
  const { properties: roleProps } = role;
  assert.ok(isRecord(roleProps), "role.properties must be an object");
  const { model } = roleProps;
  assert.ok(isRecord(model), "role.properties.model must be an object");
  assert.equal(typeof model.description, "string");
  return String(model.description);
};

describe("manageRoles tool definition — model", () => {
  it("describes the field at all", () => {
    assert.ok(modelDescription().length > 0);
  });

  it("does NOT enumerate the aliases — that list lives in CHAT_MODELS only", () => {
    const description = modelDescription().toLowerCase();
    const listed = CHAT_MODELS.filter((model) => description.includes(model));
    assert.deepEqual(listed, [], `the description names ${listed.join(", ")}; point at Settings → Model instead so it cannot go stale`);
  });

  it("tells the agent where the values come from and what an unknown one does", () => {
    const description = modelDescription();
    assert.match(description, /Settings/i, "must point the agent at the picker");
    assert.match(description, /ignored/i, "must say an unknown alias is ignored, since RoleSchema drops it silently");
  });

  // The agent rebuilds the whole role on update, so a model it does not echo
  // back is a model the user loses.
  it("warns that an update must echo the existing value", () => {
    assert.match(modelDescription(), /echo back/i);
  });
});
