// Unit tests for the phase-5 remote view item pages: the shared
// createRemoteViewItems builder (engine + thumbnail resolver stubbed) and the
// getRemoteViewItems command handler over it. See plans/done/feat-remote-view-images.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REMOTE_VIEW_ITEMS_MAX_BYTES } from "@mulmoclaude/core/remote-view";
import { createRemoteViewItems, remoteViewItemsFailureMessage, type RemoteViewItemsDeps } from "../../server/workspace/collections/remoteView.js";
import { createGetRemoteViewItems, type GetRemoteViewItemsDeps } from "../../server/remoteHost/handlers/getRemoteViewItems.js";
import { handlers } from "../../server/remoteHost/handlers/index.js";
import type { LoadedCollection } from "../../server/workspace/collections/index.js";

// A collection with an image-type `photo` field and a plain `note` field, so the
// builder can prove it inlines only declared image-type fields.
const collection = (view: Record<string, unknown>): LoadedCollection =>
  ({
    slug: "plan",
    source: "project",
    skillDir: "/s/plan",
    dataDir: "/d/plan",
    schema: {
      primaryKey: "id",
      fields: { id: { type: "string" }, title: { type: "string" }, photo: { type: "image" }, note: { type: "string" } },
      views: [view],
    },
  }) as unknown as LoadedCollection;

const RECORDS = [
  { id: "a", title: "A", photo: "images/a.png", note: "n1" },
  { id: "b", title: "B", photo: "images/b.png", note: "n2" },
];

const deps = (overrides: Partial<RemoteViewItemsDeps> = {}): RemoteViewItemsDeps => ({
  listRecords: (async () => RECORDS) as unknown as RemoteViewItemsDeps["listRecords"],
  // Identity stub: these fixtures have no computed fields, so the real resolver
  // (enrichItems) returns them unchanged — the builder just threads records through it.
  enrichItems: (async (_collection: unknown, items: unknown[]) => items) as unknown as RemoteViewItemsDeps["enrichItems"],
  // Deterministic stub: a short data URL derived from the path (no native binary).
  resolveThumbnail: (async (relPath: string) => `data:image/jpeg;base64,${Buffer.from(relPath).toString("base64")}`) as RemoteViewItemsDeps["resolveThumbnail"],
  ...overrides,
});

const view = (extra: Record<string, unknown> = {}) => ({ id: "gallery", label: "Gallery", target: "mobile", file: "views/gallery.html", ...extra });

describe("createRemoteViewItems", () => {
  it("refuses an unknown view and a desktop view", async () => {
    const build = createRemoteViewItems(deps());
    assert.deepEqual((await build(collection(view()), "ghost", { offset: 0, limit: 50 })).kind, "view-not-found");
    const desktop = { id: "year", label: "Year", file: "views/year.html" };
    assert.deepEqual((await build(collection(desktop), "year", { offset: 0, limit: 50 })).kind, "not-mobile");
  });

  it("returns a projected page with no inlining when no imageFields declared", async () => {
    const build = createRemoteViewItems(deps());
    const result = await build(collection(view()), "gallery", { offset: 0, limit: 50, fields: ["title"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 0);
    assert.deepEqual(result.page.items[0], { id: "a", title: "A" }); // projected, photo dropped
  });

  it("inlines a declared image field that survives the projection", async () => {
    const build = createRemoteViewItems(deps());
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["title", "photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 2);
    assert.equal(result.omitted, 0);
    const [item] = result.page.items;
    assert.ok(item);
    assert.match(String(item.photo), /^data:image\/jpeg;base64,/);
  });

  it("does not inline a declared field the projection dropped", async () => {
    const build = createRemoteViewItems(deps());
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["title"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 0);
    const [item] = result.page.items;
    assert.ok(item);
    assert.equal(item.photo, undefined); // dropped by projection, nothing to inline
  });

  it("ignores a declared field that is not image-type", async () => {
    const build = createRemoteViewItems(deps());
    // `note` is a plain string field — declaring it must not inline it.
    const result = await build(collection(view({ imageFields: ["note"] })), "gallery", { offset: 0, limit: 50, fields: ["title", "note", "photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 0);
    const [item] = result.page.items;
    assert.ok(item);
    assert.equal(item.note, "n1"); // untouched
    assert.equal(item.photo, "images/a.png"); // photo not declared → left as path
  });

  // #2924. The budget used to drop the offending image and carry on, so a page
  // came back with one arbitrary hole — the item whose thumbnail happened not to
  // fit — which reads as a corrupt record, not as a page that was too heavy. It
  // now ends the page there instead; the rest travel on the next one WITH their
  // thumbnails.
  it("returns a short page rather than a page with a missing thumbnail", async () => {
    // Each thumbnail is half the budget, so the first fits and the second cannot.
    const big = `data:image/jpeg;base64,${"x".repeat(Math.floor(REMOTE_VIEW_ITEMS_MAX_BYTES / 2))}`;
    const build = createRemoteViewItems(deps({ resolveThumbnail: (async () => big) as RemoteViewItemsDeps["resolveThumbnail"] }));
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 1);
    assert.equal(result.omitted, 0, "nothing was dropped — the page was cut instead");
    assert.equal(result.page.items.length, 1, "the item that did not fit belongs to the next page");
    const [firstItem] = result.page.items;
    assert.ok(firstItem);
    assert.equal(firstItem.photo, big);
  });

  // `total` counts the records behind the view, not the ones on this page — it is
  // what the documented paging idiom stops on (`loaded.length >= total`). Cutting
  // it here would hide the very records the cut deferred.
  it("keeps `total` whole and reports the returned count as `limit`", async () => {
    const big = `data:image/jpeg;base64,${"x".repeat(Math.floor(REMOTE_VIEW_ITEMS_MAX_BYTES / 2))}`;
    const build = createRemoteViewItems(deps({ resolveThumbnail: (async () => big) as RemoteViewItemsDeps["resolveThumbnail"] }));
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.page.total, RECORDS.length);
    assert.equal(result.page.limit, result.page.items.length);
    assert.equal(result.page.offset, 0);
  });

  // The guard that keeps paging alive: a first item whose own thumbnail cannot
  // fit would otherwise be asked for forever at the same offset. It keeps its
  // path — the old placeholder degradation — so the page always advances.
  it("never returns an empty page, even when the first thumbnail alone is over budget", async () => {
    const huge = `data:image/jpeg;base64,${"x".repeat(REMOTE_VIEW_ITEMS_MAX_BYTES + 1)}`;
    const build = createRemoteViewItems(deps({ resolveThumbnail: (async () => huge) as RemoteViewItemsDeps["resolveThumbnail"] }));
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.page.items.length, 1);
    const [firstItem] = result.page.items;
    assert.ok(firstItem);
    assert.equal(firstItem.photo, "images/a.png", "left as a path so the page still makes progress");
    // …and REPORTED. This is the one placeholder the page can still contain, so
    // leaving it uncounted would make the caption claim a page with no holes
    // (Codex on #2934). Reachable for real with `imageMaxEdge: 1024` and a
    // high-entropy source.
    assert.equal(result.omitted, 1, "a forced first item's over-budget image is still a placeholder — count it");
    assert.equal(result.inlined, 0);
  });

  // The counting must cover EVERY field left as a path on a forced item, not
  // just the one that tripped the budget.
  it("counts every un-inlined field on a forced first item", async () => {
    const twoFields = {
      slug: "plan",
      source: "project",
      skillDir: "/s/plan",
      dataDir: "/d/plan",
      schema: {
        primaryKey: "id",
        fields: { id: { type: "string" }, photo: { type: "image" }, cover: { type: "image" } },
        views: [view({ imageFields: ["photo", "cover"] })],
      },
    } as unknown as LoadedCollection;
    const records = [{ id: "a", photo: "images/a.png", cover: "images/a-cover.png" }];
    const huge = `data:image/jpeg;base64,${"x".repeat(REMOTE_VIEW_ITEMS_MAX_BYTES + 1)}`;
    const build = createRemoteViewItems(
      deps({
        listRecords: (async () => records) as unknown as RemoteViewItemsDeps["listRecords"],
        resolveThumbnail: (async () => huge) as RemoteViewItemsDeps["resolveThumbnail"],
      }),
    );
    const result = await build(twoFields, "gallery", { offset: 0, limit: 50, fields: ["photo", "cover"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.page.items.length, 1);
    assert.equal(result.omitted, 2, "both fields come back as paths, so both are reported");
  });

  // Both bots on #2934: with TWO image fields, the first can fit and the second
  // overflow — the item is then deferred, so neither its thumbnail nor its count
  // may go out. The counters have to describe the page that was actually
  // returned, or the preview reports images the view does not have.
  it("counts nothing from an item it defers, even when that item's first image fitted", async () => {
    const twoFields = {
      slug: "plan",
      source: "project",
      skillDir: "/s/plan",
      dataDir: "/d/plan",
      schema: {
        primaryKey: "id",
        fields: { id: { type: "string" }, photo: { type: "image" }, cover: { type: "image" } },
        views: [view({ imageFields: ["photo", "cover"] })],
      },
    } as unknown as LoadedCollection;
    const records = [
      { id: "a", photo: "images/a.png", cover: "images/a-cover.png" },
      { id: "b", photo: "images/b.png", cover: "images/b-cover.png" },
    ];
    // 30% of the budget each: item a's two fit (60%), then item b's first would
    // fit on its own but its second crosses the line — so item b is deferred
    // whole, and the thumbnail its first field already resolved is discarded.
    const thirtyPercent = `data:image/jpeg;base64,${"x".repeat(Math.floor(REMOTE_VIEW_ITEMS_MAX_BYTES * 0.3))}`;
    const build = createRemoteViewItems(
      deps({
        listRecords: (async () => records) as unknown as RemoteViewItemsDeps["listRecords"],
        resolveThumbnail: (async () => thirtyPercent) as RemoteViewItemsDeps["resolveThumbnail"],
      }),
    );
    const result = await build(twoFields, "gallery", { offset: 0, limit: 50, fields: ["photo", "cover"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.page.items.length, 1, "item b is deferred — its second image did not fit");
    assert.equal(result.inlined, 2, "only item a's two thumbnails are on the page");
    assert.equal(result.omitted, 0);
    // And the deferred record must be untouched: without a `fields` projection
    // these are the store's own objects, so a stray write would corrupt them.
    const [deferred] = records.filter((record) => record.id === "b");
    assert.ok(deferred);
    assert.equal(deferred.photo, "images/b.png", "a deferred item must not be half-inlined");
  });

  // An unresolvable image is not a budget problem — a smaller page cannot fix
  // it — so it is skipped in place rather than ending the page, which would
  // wedge paging at that item forever.
  it("skips an unresolvable image in place instead of cutting the page", async () => {
    const build = createRemoteViewItems(deps({ resolveThumbnail: (async () => null) as unknown as RemoteViewItemsDeps["resolveThumbnail"] }));
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 0);
    assert.equal(result.omitted, RECORDS.length);
    assert.equal(result.page.items.length, RECORDS.length, "the page is not cut short by an unresolvable image");
  });

  it("serves host-resolved computed fields (ref-crossing derived, etc.) the resolver produced", async () => {
    // Prove the builder hydrates through enrichItems, not a record-local evaluator:
    // a derived `value` that only the full resolver could compute (e.g. shares *
    // ticker.price) must reach the projected page unchanged.
    const enriched = RECORDS.map((record) => ({ ...record, value: record.id === "a" ? 100 : 250 }));
    const build = createRemoteViewItems(deps({ enrichItems: (async () => enriched) as unknown as RemoteViewItemsDeps["enrichItems"] }));
    const result = await build(collection(view()), "gallery", { offset: 0, limit: 50, fields: ["title", "value"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.page.items[0], { id: "a", title: "A", value: 100 });
    assert.deepEqual(result.page.items[1], { id: "b", title: "B", value: 250 });
  });

  it("rejects a page whose base JSON already exceeds the doc budget", async () => {
    // An embed column can attach a whole record per row; if the projected base
    // page alone overflows the budget, fail with an actionable error rather than
    // letting the oversized doc break the downstream command-channel write.
    const huge = "x".repeat(REMOTE_VIEW_ITEMS_MAX_BYTES);
    const build = createRemoteViewItems(deps({ enrichItems: (async () => [{ id: "a", blob: huge }]) as unknown as RemoteViewItemsDeps["enrichItems"] }));
    const result = await build(collection(view()), "gallery", { offset: 0, limit: 50, fields: ["blob"] });
    assert.equal(result.kind, "too-large");
    if (result.kind !== "too-large") return;
    assert.ok(result.bytes > REMOTE_VIEW_ITEMS_MAX_BYTES);
  });

  it("maps failure kinds to actionable messages", () => {
    assert.match(remoteViewItemsFailureMessage({ kind: "view-not-found", viewId: "v" }, "plan"), /'v' not found on collection 'plan'/);
    assert.match(remoteViewItemsFailureMessage({ kind: "not-mobile", viewId: "v" }, "plan"), /target: "mobile"/);
    assert.match(remoteViewItemsFailureMessage({ kind: "too-large", bytes: 1_000_000 }, "plan"), /over the 900000-byte command-channel budget/);
  });
});

describe("createGetRemoteViewItems", () => {
  const handlerDeps = (overrides: Partial<GetRemoteViewItemsDeps> = {}): GetRemoteViewItemsDeps => ({
    loadCollection: (async (slug: string) =>
      slug === "missing" ? null : collection(view({ imageFields: ["photo"] }))) as unknown as GetRemoteViewItemsDeps["loadCollection"],
    remoteViewItems: (async () => ({
      kind: "ok",
      page: { items: [], total: 0, offset: 0, limit: 50 },
      inlined: 3,
      omitted: 1,
    })) as unknown as GetRemoteViewItemsDeps["remoteViewItems"],
    ...overrides,
  });

  it("returns { page, inlined, omitted } for a mobile view", async () => {
    const handler = createGetRemoteViewItems(handlerDeps());
    assert.deepEqual(await handler({ slug: "plan", viewId: "gallery" }), { page: { items: [], total: 0, offset: 0, limit: 50 }, inlined: 3, omitted: 1 });
  });

  it("throws when the collection is not found", async () => {
    const handler = createGetRemoteViewItems(handlerDeps());
    await assert.rejects(async () => handler({ slug: "missing", viewId: "gallery" }), /collection 'missing' not found/);
  });

  it("throws the shared failure message on a non-ok build", async () => {
    const handler = createGetRemoteViewItems(
      handlerDeps({ remoteViewItems: (async () => ({ kind: "not-mobile", viewId: "year" })) as unknown as GetRemoteViewItemsDeps["remoteViewItems"] }),
    );
    await assert.rejects(async () => handler({ slug: "plan", viewId: "year" }), /not a mobile view/);
  });

  it("is registered in the runner's method table", () => {
    assert.equal(typeof handlers.getRemoteViewItems, "function");
  });
});
