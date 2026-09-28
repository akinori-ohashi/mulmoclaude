// Unit tests for the startup reconcile's row mapping
// (src/composables/collections/collectionShortcutRows.ts).
//
// The case that matters is the ROUND TRIP: rows that drop `color` make
// `reconcileShortcuts` strip a pinned shortcut's accent colour and rewrite the
// file on every app start, while the Collections index put it back (#3340).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { CollectionSummary } from "@mulmoclaude/core/collection";
import { collectionShortcutRows } from "../../src/composables/collections/collectionShortcutRows";
import { reconcileShortcuts } from "../../src/composables/shortcutRefresh";
import type { Shortcut } from "../../src/types/shortcuts";

const coloured: CollectionSummary = { slug: "books", title: "Books", icon: "menu_book", color: "lime", source: "user" };
const plain: CollectionSummary = { slug: "notes", title: "Notes", icon: "note", source: "project" };

describe("collectionShortcutRows", () => {
  it("carries the accent colour", () => {
    assert.deepEqual(collectionShortcutRows([coloured]), [{ slug: "books", title: "Books", icon: "menu_book", color: "lime" }]);
  });

  it("omits the color key entirely when the collection has none", () => {
    assert.deepEqual(collectionShortcutRows([plain]), [{ slug: "notes", title: "Notes", icon: "note" }]);
  });

  it("falls back to the index view's icon when the summary has an empty one", () => {
    assert.deepEqual(collectionShortcutRows([{ ...plain, icon: "" }]), [{ slug: "notes", title: "Notes", icon: "dataset" }]);
  });

  it("returns an empty list for no collections", () => {
    assert.deepEqual(collectionShortcutRows([]), []);
  });
});

describe("startup reconcile against collectionShortcutRows", () => {
  const pinned: Shortcut[] = [
    { kind: "collection", slug: "books", title: "Books", icon: "menu_book", color: "lime" },
    { kind: "collection", slug: "notes", title: "Notes", icon: "note" },
    { kind: "feed", slug: "news", title: "News", icon: "rss_feed", color: "sky" },
  ];

  it("does not drift when the pinned shortcuts already match — no rewrite, colour kept", () => {
    const { next, drifted } = reconcileShortcuts(pinned, "collection", collectionShortcutRows([coloured, plain]));
    assert.equal(drifted, false);
    assert.deepEqual(next, pinned);
  });

  it("restores a colour missing from the persisted shortcut", () => {
    const stripped: Shortcut[] = [{ kind: "collection", slug: "books", title: "Books", icon: "menu_book" }];
    const { next, drifted } = reconcileShortcuts(stripped, "collection", collectionShortcutRows([coloured]));
    assert.equal(drifted, true);
    assert.deepEqual(next, [{ kind: "collection", slug: "books", title: "Books", icon: "menu_book", color: "lime" }]);
  });
});
