import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveRequestedRoleId } from "../../../src/utils/session/roleSelection.ts";

// The caller is a plugin, and behind it possibly a sandboxed custom view that
// named the role itself. What must not happen is an id the user could not have
// picked selecting the assistant a turn runs as.
const ROLES = [{ id: "general" }, { id: "coder" }, { id: "debugger", isDebugRole: true }, { id: "writer", isDebugRole: false }];

describe("resolveRequestedRoleId", () => {
  it("honours an id that names a selectable role", () => {
    assert.equal(resolveRequestedRoleId("coder", ROLES), "coder");
  });

  it("honours a role that declares isDebugRole false", () => {
    assert.equal(resolveRequestedRoleId("writer", ROLES), "writer");
  });

  it("refuses a debug role, which the selector hides outside dev mode", () => {
    // The whole point: it EXISTS, so an existence check alone would honour it.
    assert.equal(resolveRequestedRoleId("debugger", ROLES), undefined);
  });

  it("refuses an id that names no role", () => {
    assert.equal(resolveRequestedRoleId("admin", ROLES), undefined);
  });

  it("refuses an empty id, which `??` would have honoured", () => {
    assert.equal(resolveRequestedRoleId("", ROLES), undefined);
  });

  it("refuses an empty id even when a role carries one", () => {
    // `RoleSchema` does not forbid `id: ""`, so without an early return the
    // lookup would MATCH and hand the empty id on as a real answer.
    assert.equal(resolveRequestedRoleId("", [{ id: "" }, ...ROLES]), undefined);
  });

  it("asks for nothing when no id was supplied, so the caller's own default stands", () => {
    assert.equal(resolveRequestedRoleId(undefined, ROLES), undefined);
  });

  it("refuses a duplicated id whose first entry is a debug role", () => {
    // `loadCustomRoles` warns about duplicate ids without collapsing them, so two
    // roles can share one. First-wins is the answer this file gives, and it is the
    // safe one: a scan that accepted any non-debug twin would honour the id.
    assert.equal(resolveRequestedRoleId("dup", [{ id: "dup", isDebugRole: true }, { id: "dup" }]), undefined);
  });

  it("refuses everything while no roles are known", () => {
    assert.equal(resolveRequestedRoleId("general", []), undefined);
  });

  it("does not match on a prototype property name", () => {
    // `find` compares ids, so nothing here can name `toString` or `constructor`
    // into a role — pinned because a lookup rewritten as a map could hand the
    // requested string back as though a role had matched.
    assert.equal(resolveRequestedRoleId("constructor", ROLES), undefined);
    assert.equal(resolveRequestedRoleId("toString", ROLES), undefined);
  });
});
