// Unit tests for the pure view-mode resolution logic
// (packages/plugins/collection-plugin/src/vue/collectionViewMode.ts): the
// stale-mode collapse (`resolveActiveViewMode`) and the persisted-mode guard
// (`isCollectionViewMode`). These back `useViewMode` and both restore paths (the
// slug's localStorage preference and the embedded card's `viewState`), keeping
// the composable a thin reactive shell. The localStorage read/write halves of the
// module touch a browser global, so they're exercised by the
// collection-state-persist e2e; here we pin the field-derived decision the
// component's body branches key off.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveActiveViewMode, isCollectionViewMode } from "../../../packages/plugins/collection-plugin/src/vue/collectionViewMode";

describe("resolveActiveViewMode", () => {
  it("keeps table always (no gating field required)", () => {
    assert.equal(resolveActiveViewMode("table", false, false, []), "table");
    assert.equal(resolveActiveViewMode("table", true, true, ["a"]), "table");
  });

  it("keeps calendar only while a date field gates it", () => {
    assert.equal(resolveActiveViewMode("calendar", true, false, []), "calendar");
  });

  // The core collapse: a stored `calendar` whose date field vanished (e.g. after a
  // collection switch) must fall back to `table`, not render an empty grid.
  it("collapses calendar to table when no date field", () => {
    assert.equal(resolveActiveViewMode("calendar", false, false, []), "table");
  });

  it("keeps kanban only while an enum field gates it", () => {
    assert.equal(resolveActiveViewMode("kanban", false, true, []), "kanban");
  });

  it("collapses kanban to table when no enum field", () => {
    assert.equal(resolveActiveViewMode("kanban", false, false, []), "table");
  });

  // A kanban mode must NOT be rescued by the calendar gate (each branch checks its
  // own field only).
  it("does not let the calendar gate rescue a kanban mode", () => {
    assert.equal(resolveActiveViewMode("kanban", true, false, []), "table");
  });

  it("keeps a custom mode while its id is still a declared view", () => {
    assert.equal(resolveActiveViewMode("custom:board", false, false, ["board", "other"]), "custom:board");
  });

  it("collapses a custom mode to table when its id is gone", () => {
    assert.equal(resolveActiveViewMode("custom:board", true, true, ["other"]), "table");
    assert.equal(resolveActiveViewMode("custom:board", false, false, []), "table");
  });
});

describe("isCollectionViewMode", () => {
  it("accepts the built-in modes", () => {
    assert.equal(isCollectionViewMode("table"), true);
    assert.equal(isCollectionViewMode("calendar"), true);
    assert.equal(isCollectionViewMode("kanban"), true);
  });

  // The card's restore state and the slug's localStorage preference share this
  // guard, so a custom view has to survive it — narrowing it to a built-in is
  // what sent an embedded card back to the table on every remount (#3061).
  it("accepts any custom:<id>, including an id no schema declares", () => {
    assert.equal(isCollectionViewMode("custom:board"), true);
    assert.equal(isCollectionViewMode("custom:deleted-long-ago"), true);
  });

  // An empty id is still a `custom:` key: `resolveActiveViewMode` collapses it to
  // the table at render time, so it never reaches a branch that would render it.
  it("accepts a custom key with an empty id (render time collapses it)", () => {
    assert.equal(isCollectionViewMode("custom:"), true);
  });

  it("rejects an unknown mode string", () => {
    assert.equal(isCollectionViewMode("gallery"), false);
    assert.equal(isCollectionViewMode(""), false);
    assert.equal(isCollectionViewMode("Custom:board"), false);
  });

  // A corrupted localStorage entry / tool result could hold anything; the guard
  // type-checks `string` first so `.startsWith` never runs on a non-string.
  it("rejects non-string values without throwing", () => {
    assert.equal(isCollectionViewMode(undefined), false);
    assert.equal(isCollectionViewMode(null), false);
    assert.equal(isCollectionViewMode(3), false);
    assert.equal(isCollectionViewMode(["custom:board"]), false);
    assert.equal(isCollectionViewMode({ view: "table" }), false);
  });
});
