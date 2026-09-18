import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// Validation tests for custom-view (`views[]`) schema registrations (see
// plans/done/feat-collections-custom-views.md). Drives the exported Zod schema
// directly — the rules are pure shape checks, no filesystem needed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CollectionSchemaZ } from "@mulmoclaude/core/collection/server";

const base = {
  title: "Plans",
  icon: "calendar_month",
  dataPath: "data/plans/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
  },
};

function withViews(views: unknown) {
  return CollectionSchemaZ.safeParse({ ...base, views });
}

describe("collection schema — custom views validation", () => {
  it("accepts a schema with no views (back-compat)", () => {
    assert.equal(CollectionSchemaZ.safeParse(base).success, true);
  });

  it("accepts read-only and read/write views with valid files", () => {
    const result = withViews([
      { id: "year", label: "Year", icon: "grid_view", file: "views/year.html", capabilities: ["read"] },
      { id: "planner", label: "Planner", file: "views/planner.html", capabilities: ["read", "write"] },
    ]);
    assert.equal(result.success, true);
  });

  it("accepts a view with no capabilities (defaults applied downstream)", () => {
    assert.equal(withViews([{ id: "year", label: "Year", file: "views/year.html" }]).success, true);
  });

  it("rejects a file outside views/ or without .html", () => {
    assert.equal(withViews([{ id: "a", label: "A", file: "templates/a.html" }]).success, false);
    assert.equal(withViews([{ id: "b", label: "B", file: "views/b.txt" }]).success, false);
    assert.equal(withViews([{ id: "c", label: "C", file: "views/../secret.html" }]).success, false);
  });

  it("rejects duplicate view ids", () => {
    const result = withViews([
      { id: "dup", label: "One", file: "views/one.html" },
      { id: "dup", label: "Two", file: "views/two.html" },
    ]);
    assert.equal(result.success, false);
  });

  it("rejects an id that is not a valid slug", () => {
    assert.equal(withViews([{ id: "bad/id", label: "X", file: "views/x.html" }]).success, false);
  });

  it("rejects an unknown capability value", () => {
    assert.equal(withViews([{ id: "a", label: "A", file: "views/a.html", capabilities: ["delete"] }]).success, false);
  });

  it("accepts target: mobile / desktop, rejects anything else", () => {
    assert.equal(withViews([{ id: "phone", label: "Phone", file: "views/phone.html", target: "mobile" }]).success, true);
    assert.equal(withViews([{ id: "year", label: "Year", file: "views/year.html", target: "desktop" }]).success, true);
    assert.equal(withViews([{ id: "tv", label: "TV", file: "views/tv.html", target: "tv" }]).success, false);
  });

  it("accepts mobile editableFields / allowDelete, rejects wrong types", () => {
    assert.equal(
      withViews([{ id: "phone", label: "Phone", file: "views/phone.html", target: "mobile", editableFields: ["done"], allowDelete: true }]).success,
      true,
    );
    assert.equal(withViews([{ id: "phone", label: "Phone", file: "views/phone.html", target: "mobile", editableFields: "done" }]).success, false);
    assert.equal(withViews([{ id: "phone", label: "Phone", file: "views/phone.html", target: "mobile", editableFields: [""] }]).success, false);
    assert.equal(withViews([{ id: "phone", label: "Phone", file: "views/phone.html", target: "mobile", allowDelete: "yes" }]).success, false);
  });

  it("accepts allowSendChat, rejects a non-boolean", () => {
    const view = { id: "board", label: "Board", file: "views/board.html" };
    assert.equal(withViews([{ ...view, allowSendChat: true }]).success, true);
    assert.equal(withViews([{ ...view, allowSendChat: false }]).success, true);
    assert.equal(withViews([view]).success, true); // absent ⇒ draft (default-deny)
    assert.equal(withViews([{ ...view, allowSendChat: "yes" }]).success, false);
    assert.equal(withViews([{ ...view, allowSendChat: 1 }]).success, false);
  });

  it("accepts mobile imageFields / imageMaxEdge, rejects wrong types", () => {
    const gallery = { id: "gallery", label: "Gallery", file: "views/gallery.html", target: "mobile" as const };
    assert.equal(withViews([{ ...gallery, imageFields: ["photo"], imageMaxEdge: 384 }]).success, true);
    assert.equal(withViews([{ ...gallery, imageFields: ["photo"] }]).success, true); // imageMaxEdge optional
    assert.equal(withViews([{ ...gallery, imageFields: "photo" }]).success, false); // not an array
    assert.equal(withViews([{ ...gallery, imageFields: [""] }]).success, false); // empty field name
    assert.equal(withViews([{ ...gallery, imageMaxEdge: 384.5 }]).success, false); // not an int
    assert.equal(withViews([{ ...gallery, imageMaxEdge: "384" }]).success, false); // not a number
  });
});
