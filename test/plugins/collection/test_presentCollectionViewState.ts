// Unit tests for the embedded `presentCollection` card's restore-state reader
// (packages/plugins/collection-plugin/src/vue/chat/presentCollectionViewState.ts).
// The host stores a tool result's `viewState` as an opaque record, so this
// validator is the only thing standing between whatever is on disk and the props
// the card mounts with. It also decides which view modes a card can restore —
// narrowing that to the built-ins is what made a card fall back to the table on
// every remount (#3061).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toViewState } from "../../../packages/plugins/collection-plugin/src/vue/chat/presentCollectionViewState";

describe("toViewState", () => {
  it("returns null for a non-object", () => {
    assert.equal(toViewState(null), null);
    assert.equal(toViewState(undefined), null);
    assert.equal(toViewState("table"), null);
    assert.equal(toViewState(7), null);
  });

  it("reads back a complete built-in state", () => {
    assert.deepEqual(toViewState({ selected: "rec-1", view: "calendar", anchorField: "due", groupField: "status" }), {
      selected: "rec-1",
      view: "calendar",
      anchorField: "due",
      groupField: "status",
    });
  });

  // The #3061 regression: a card that persisted a custom view must get it back,
  // exactly as calendar / kanban do.
  it("restores a custom view", () => {
    assert.deepEqual(toViewState({ view: "custom:board" }), { view: "custom:board" });
  });

  // A view the schema has since dropped stays readable here; the collapse to the
  // table happens at render time (`resolveActiveViewMode`).
  it("restores a custom view whose id no longer exists", () => {
    assert.deepEqual(toViewState({ view: "custom:deleted-long-ago" }), { view: "custom:deleted-long-ago" });
  });

  it("drops a view that is neither built-in nor custom", () => {
    assert.deepEqual(toViewState({ view: "gallery" }), {});
    assert.deepEqual(toViewState({ view: 3 }), {});
    assert.deepEqual(toViewState({ view: null }), {});
  });

  // `selected: null` means "the user explicitly closed the record" — distinct
  // from an absent key, which falls back to the tool's initial `itemId`.
  it("keeps an explicit null selection, and omits the key when absent", () => {
    assert.deepEqual(toViewState({ selected: null }), { selected: null });
    assert.equal("selected" in (toViewState({ view: "table" }) ?? {}), false);
  });

  it("drops fields whose stored type is wrong", () => {
    assert.deepEqual(toViewState({ selected: 1, anchorField: [], groupField: {} }), {});
  });

  it("ignores keys the interface does not declare", () => {
    assert.deepEqual(toViewState({ view: "kanban", sortState: { field: "name" }, rogue: true }), { view: "kanban" });
  });

  it("reads an array as an object, keeping nothing", () => {
    assert.deepEqual(toViewState(["table"]), {});
  });
});
