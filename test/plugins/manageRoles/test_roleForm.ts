import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formToRole,
  roleToForm,
  parseCustomRoles,
  parseManageRolesResult,
  parseQueriesText,
  validateRoleForm,
  isValidRoleId,
  DEFAULT_ROLE_ICON,
  emptyRoleForm,
  type RoleForm,
} from "../../../src/plugins/manageRoles/roleForm.js";

const form = (over: Partial<RoleForm> = {}): RoleForm => ({
  id: "analyst",
  name: "Analyst",
  icon: "insights",
  prompt: "You are an analyst.",
  selectedPlugins: ["chart"],
  queriesText: "",
  model: "",
  ...over,
});

describe("parseQueriesText", () => {
  it("returns [] for empty input", () => {
    assert.deepEqual(parseQueriesText(""), []);
  });

  it("drops blank / whitespace-only lines and trims", () => {
    assert.deepEqual(parseQueriesText("  a \n\n  \n b "), ["a", "b"]);
  });

  it("handles a single line with no newline", () => {
    assert.deepEqual(parseQueriesText("just one"), ["just one"]);
  });

  it("handles CRLF input", () => {
    assert.deepEqual(parseQueriesText("a\r\nb"), ["a", "b"]);
  });
});

describe("formToRole", () => {
  it("trims id and name and splits queries", () => {
    const role = formToRole(form({ id: "  a  ", name: "  A  ", queriesText: "q1\nq2" }));
    assert.equal(role.id, "a");
    assert.equal(role.name, "A");
    assert.deepEqual(role.queries, ["q1", "q2"]);
  });

  // Regression: an empty icon field must fall back on the edit path too —
  // it used to persist "" and drop the icon everywhere.
  it("falls back to the default icon when the field is blank", () => {
    assert.equal(formToRole(form({ icon: "" })).icon, DEFAULT_ROLE_ICON);
    assert.equal(formToRole(form({ icon: "   " })).icon, DEFAULT_ROLE_ICON);
  });

  it("keeps a provided icon", () => {
    assert.equal(formToRole(form({ icon: "star" })).icon, "star");
  });

  // Prompt whitespace can be meaningful — pin that it is NOT trimmed.
  it("does not trim the prompt", () => {
    assert.equal(formToRole(form({ prompt: "  keep  " })).prompt, "  keep  ");
  });
});

describe("roleToForm / round-trip", () => {
  it("joins queries with newlines and copies plugins", () => {
    const result = roleToForm({ id: "a", name: "A", icon: "x", prompt: "p", availablePlugins: ["chart"], queries: ["q1", "q2"] });
    assert.equal(result.queriesText, "q1\nq2");
    assert.deepEqual(result.selectedPlugins, ["chart"]);
  });

  it("treats missing queries as an empty field", () => {
    assert.equal(roleToForm({ id: "a", name: "A", icon: "x", prompt: "p", availablePlugins: [] }).queriesText, "");
  });

  it("round-trips a role back to itself", () => {
    const role = { id: "a", name: "A", icon: "x", prompt: "p", availablePlugins: ["chart"], queries: ["q1"] };
    assert.deepEqual(formToRole(roleToForm(role)), role);
  });
});

describe("isValidRoleId", () => {
  it("accepts alphanumerics, dash and underscore", () => {
    assert.equal(isValidRoleId("my_role-2"), true);
  });

  it("rejects path-traversal and separator characters", () => {
    for (const candidate of ["../x", "a/b", "a.b", "", "a b", "role!"]) {
      assert.equal(isValidRoleId(candidate), false, `${candidate} should be invalid`);
    }
  });
});

describe("validateRoleForm", () => {
  it("passes a valid form", () => {
    assert.equal(validateRoleForm(form(), null, ["other"]), null);
  });

  it("flags an empty id", () => {
    assert.deepEqual(validateRoleForm(form({ id: "   " }), null, []), { code: "idRequired", id: "" });
  });

  it("flags an id with illegal characters", () => {
    assert.equal(validateRoleForm(form({ id: "../evil" }), null, [])?.code, "idInvalid");
  });

  it("flags an empty name", () => {
    assert.equal(validateRoleForm(form({ name: "  " }), null, [])?.code, "nameRequired");
  });

  it("flags a duplicate id", () => {
    assert.equal(validateRoleForm(form({ id: "dup" }), null, ["dup"])?.code, "idDuplicate");
  });

  it("excludes the role's own id on rename", () => {
    assert.equal(validateRoleForm(form({ id: "self" }), "self", ["self"]), null);
  });
});

describe("parseCustomRoles", () => {
  const wireRole = { id: "analyst", name: "Analyst", icon: "insights", prompt: "You are an analyst.", availablePlugins: ["chart"] };

  it("rebuilds a well-formed list and drops unknown fields", () => {
    assert.deepEqual(parseCustomRoles([{ ...wireRole, isDebugRole: true }]), [wireRole]);
  });

  it("keeps queries only when it is a string list", () => {
    assert.deepEqual(parseCustomRoles([{ ...wireRole, queries: ["a", "b"] }]), [{ ...wireRole, queries: ["a", "b"] }]);
    assert.deepEqual(parseCustomRoles([{ ...wireRole, queries: [1] }]), [wireRole]);
  });

  it("accepts an empty list", () => {
    assert.deepEqual(parseCustomRoles([]), []);
  });

  it("returns null for a non-array payload", () => {
    assert.equal(parseCustomRoles(null), null);
    assert.equal(parseCustomRoles({ customRoles: [] }), null);
    assert.equal(parseCustomRoles(undefined), null);
  });

  it("returns null when any entry is malformed, so the caller keeps its list", () => {
    assert.equal(parseCustomRoles([wireRole, { ...wireRole, name: 5 }]), null);
    assert.equal(parseCustomRoles([{ ...wireRole, availablePlugins: "chart" }]), null);
    assert.equal(parseCustomRoles(["analyst"]), null);
  });
});

// `null` from this parser is the "keep the list you already have" signal.
// The refreshList() call sites must not collapse it to `[]` — doing so blanks
// the panel for anyone whose roles file has one hand-edited row (#2738 review).
describe("parseManageRolesResult", () => {
  const wireRole = { id: "analyst", name: "Analyst", icon: "insights", prompt: "You are an analyst.", availablePlugins: ["chart"] };

  it("reads the list out of a manage response envelope", () => {
    assert.deepEqual(parseManageRolesResult({ success: true, data: { customRoles: [wireRole] } }), [wireRole]);
  });

  it("reads an empty list as an empty list", () => {
    assert.deepEqual(parseManageRolesResult({ success: true, data: { customRoles: [] } }), []);
  });

  it("returns null — not [] — when the envelope carries no usable list", () => {
    assert.equal(parseManageRolesResult({ success: true }), null);
    assert.equal(parseManageRolesResult({ success: true, data: {} }), null);
    assert.equal(parseManageRolesResult({ success: true, data: { customRoles: [{ id: "analyst" }] } }), null);
    assert.equal(parseManageRolesResult({ success: true, data: "roles" }), null);
    assert.equal(parseManageRolesResult(null), null);
  });
});

// #3104. The ORIGINAL proposal for this feature was "add a `model` key to the
// role JSON, no UI needed". That does not work, and this suite is the reason:
// the role object is rebuilt field by field on every edit path, so a key
// nothing here knows about is silently dropped the first time a user edits the
// role — settings vanishing with no error. These assertions are what make the
// field survive a round trip.
describe("role model round-trip", () => {
  it("carries a model from the form onto the role", () => {
    assert.equal(formToRole(form({ model: "haiku" })).model, "haiku");
  });

  it("omits the key entirely when unset, so `role.model ?? setting` falls through", () => {
    const role = formToRole(form({ model: "" }));
    assert.equal("model" in role, false);
  });

  it("survives form -> role -> form", () => {
    assert.equal(roleToForm(formToRole(form({ model: "sonnet" }))).model, "sonnet");
  });

  it("shows as the not-set option when the role has none", () => {
    assert.equal(roleToForm({ id: "a", name: "A", icon: "person", prompt: "p", availablePlugins: [] }).model, "");
  });

  // The failure this guards is editing an UNRELATED field: the whole role is
  // rebuilt from the form, so if the form did not carry the model, saving a
  // renamed role would drop it.
  it("keeps the model when another field is edited", () => {
    const saved = formToRole(form({ model: "opus" }));
    const reopened = roleToForm(saved);
    const renamed = formToRole({ ...reopened, name: "Renamed" });
    assert.equal(renamed.model, "opus");
    assert.equal(renamed.name, "Renamed");
  });

  it("parses a stored model off the wire, dropping only malformed values", () => {
    const base = { id: "a", name: "A", icon: "person", prompt: "p", availablePlugins: [] };
    assert.equal(parseCustomRoles([{ ...base, model: "haiku" }])?.[0]?.model, "haiku");
    // A malformed field costs that field, not the whole role. An UNKNOWN
    // alias is carried through on purpose — the host's RoleSchema is the one
    // validator, and it drops the alias on the way to the agent. Checking it
    // here would make this parser depend on host context it cannot read.
    assert.equal(parseCustomRoles([{ ...base, model: 42 }])?.[0]?.model, undefined);
    assert.equal(parseCustomRoles([{ ...base, model: "" }])?.[0]?.model, undefined);
    assert.equal(parseCustomRoles([{ ...base, model: "gpt-4o" }])?.[0]?.model, "gpt-4o");
  });

  it("builds a blank form with the model unset", () => {
    assert.equal(emptyRoleForm().model, "");
  });

  // The create form is what a user looks at, and it showed the default icon
  // before this factory replaced three inline literals. `formToRole` supplies
  // the same default either way, so only the VISIBLE value was at risk — which
  // is precisely the kind of change a "pure refactor" hides.
  it("pre-fills the default icon, as the create form always did", () => {
    assert.equal(emptyRoleForm().icon, DEFAULT_ROLE_ICON);
    assert.equal(formToRole(emptyRoleForm()).icon, DEFAULT_ROLE_ICON);
  });
});
