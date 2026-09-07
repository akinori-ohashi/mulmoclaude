// Assemble one mobile (`target: "mobile"`) custom view for the remote client:
// find the view entry, read its HTML (source-aware staging read), pick its
// i18n dict for the requested locale, wrap it into the sandboxed srcdoc
// (CSP + postMessage bootstrap — @mulmoclaude/core/remote-view), and enforce
// the 1 MiB command-document budget. Shared by the `getRemoteView` channel
// handler and the desktop preview's HTTP route so both serve the IDENTICAL
// artifact (plans/done/feat-remote-custom-view.md, decision 2).
//
// Discriminated result (not throw) so the HTTP route can map each failure to
// its status; the channel handler converts non-ok to a thrown error via
// `remoteViewFailureMessage`. Factory keeps the mapping unit-testable with the
// engine stubbed.
import {
  buildRemoteViewSrcdoc,
  clampImageMaxEdge,
  pageFromItems,
  REMOTE_VIEW_ITEMS_MAX_BYTES,
  REMOTE_VIEW_MAX_BYTES,
  type RemoteViewItem,
  type RemoteViewMutateRequest,
  type RemoteViewPage,
  type RemoteViewPageRequest,
} from "@mulmoclaude/core/remote-view";
import { enrichItems } from "@mulmoclaude/core/collection/server";
import {
  readCustomViewHtml,
  readCustomViewI18n,
  safeRecordId,
  storeFor,
  type CollectionCustomView,
  type CollectionItem,
  type CollectionSchema,
  type CollectionStore,
  type LoadedCollection,
} from "./index.js";
import { resolveThumbnail } from "../../utils/files/thumbnail-store.js";

/** Shared head of every remote-view operation. Its non-ok members are shaped to
 *  be assignable to all three public result types below, so a caller can return
 *  a refusal straight through without re-mapping it. */
export type ResolveMobileViewResult =
  { kind: "ok"; view: CollectionCustomView } | { kind: "view-not-found"; viewId: string } | { kind: "not-mobile"; viewId: string };

/** Look up a declared view and refuse it unless it targets mobile. EVERY remote
 *  entry point resolves its view through here, so the guard cannot be forgotten
 *  by a new one: a desktop view's HTML assumes the token/dataUrl contract and
 *  would just break on the phone — refuse it instead of serving a broken page. */
export function resolveMobileView(collection: LoadedCollection, viewId: string): ResolveMobileViewResult {
  const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
  if (!view) return { kind: "view-not-found", viewId };
  if (view.target !== "mobile") return { kind: "not-mobile", viewId };
  return { kind: "ok", view };
}

export interface RemoteViewInfo {
  id: string;
  label: string;
  icon?: string;
  target: "mobile";
}

export type RemoteViewBuildResult =
  | { kind: "ok"; view: RemoteViewInfo; srcdoc: string; bytes: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "file-missing"; file: string }
  | { kind: "too-large"; bytes: number };

export interface BuildRemoteViewDeps {
  readCustomViewHtml: typeof readCustomViewHtml;
  readCustomViewI18n: typeof readCustomViewI18n;
}

export const createBuildRemoteView =
  (deps: BuildRemoteViewDeps) =>
  async (collection: LoadedCollection, viewId: string, locale: string): Promise<RemoteViewBuildResult> => {
    const resolved = resolveMobileView(collection, viewId);
    if (resolved.kind !== "ok") return resolved;
    const { view } = resolved;
    const html = await deps.readCustomViewHtml(collection, view.file);
    if (html === null) return { kind: "file-missing", file: view.file };
    const i18n = view.i18n ? await deps.readCustomViewI18n(collection, view.i18n, locale) : { locale: "", dict: {} };
    // `writable` gates the client-side updateItem/deleteItem install; the host
    // re-derives + enforces the actual policy on every mutate (createMutateRemoteView).
    const writable = isWritableView(view);
    const srcdoc = buildRemoteViewSrcdoc(html, { slug: collection.slug, locale: i18n.locale, dict: i18n.dict, writable });
    const bytes = Buffer.byteLength(srcdoc, "utf8");
    if (bytes > REMOTE_VIEW_MAX_BYTES) return { kind: "too-large", bytes };
    return { kind: "ok", view: { id: view.id, label: view.label, ...(view.icon ? { icon: view.icon } : {}), target: "mobile" }, srcdoc, bytes };
  };

export const buildRemoteView = createBuildRemoteView({ readCustomViewHtml, readCustomViewI18n });

/** One message per failure kind, shared by the channel handler (throws it) and
 *  the HTTP route (sends it with the matching status). */
export function remoteViewFailureMessage(result: Exclude<RemoteViewBuildResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "view-not-found") return `custom view '${result.viewId}' not found on collection '${slug}'`;
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "file-missing") return `view file '${result.file}' not found — author it at data/skills/${slug}/${result.file}`;
  return `mobile view srcdoc is ${result.bytes} bytes — over the ${REMOTE_VIEW_MAX_BYTES}-byte command-channel budget; slim the HTML`;
}

// ── Mutate (phase 4 — plans/done/feat-remote-writable-view.md) ──
// A `target: "mobile"` view's update/delete, authorized by its OWN declared
// surface (editableFields / allowDelete) and enforced HOST-side — the client is
// never trusted. Shared by the `mutateRemoteViewItem` channel handler (phone)
// and the `…/remote-view/:viewId/mutate` HTTP route (desktop preview), so both
// transports apply identical policy. Discriminated result (not throw) mirrors
// the build result above.

/** True when a mobile view declared ANY write surface. Also gates the srcdoc's
 *  `writable` boot flag so the client only exposes methods the host will honor. */
function isWritableView(view: CollectionCustomView): boolean {
  return (view.editableFields?.length ?? 0) > 0 || view.allowDelete === true;
}

export type MutateRemoteViewResult =
  | { kind: "ok"; op: "update"; item: CollectionItem }
  | { kind: "ok"; op: "delete"; id: string }
  | { kind: "too-large"; bytes: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "not-writable"; viewId: string }
  | { kind: "read-only-collection" }
  | { kind: "field-not-editable"; field: string }
  | { kind: "delete-not-allowed" }
  | { kind: "invalid-patch" }
  | { kind: "item-not-found"; id: string }
  | { kind: "invalid-id"; id: string }
  | { kind: "path-escape" };

export interface MutateRemoteViewDeps {
  storeFor: (collection: LoadedCollection) => CollectionStore;
  enrichItems: typeof enrichItems;
  resolveThumbnail: typeof resolveThumbnail;
}

export const createMutateRemoteView =
  (deps: MutateRemoteViewDeps) =>
  async (collection: LoadedCollection, viewId: string, request: RemoteViewMutateRequest): Promise<MutateRemoteViewResult> => {
    const resolved = resolveMobileView(collection, viewId);
    if (resolved.kind !== "ok") return resolved;
    const { view } = resolved;
    // A dataSource collection is read-only regardless of what write surface
    // the view declares — the collection-level rule outranks the view's. The
    // store encodes it as absent write/delete methods.
    const store = deps.storeFor(collection);
    if (!store.write || !store.delete) return { kind: "read-only-collection" };
    if (!isWritableView(view)) return { kind: "not-writable", viewId };
    return request.op === "delete" ? deleteViaView(store.delete, view.allowDelete === true, request.id) : updateViaView(deps, store, collection, view, request);
  };

async function deleteViaView(remove: NonNullable<CollectionStore["delete"]>, allowDelete: boolean, itemId: string): Promise<MutateRemoteViewResult> {
  if (!allowDelete) return { kind: "delete-not-allowed" };
  const result = await remove(itemId);
  if (result.kind === "invalid-id") return { kind: "invalid-id", id: result.itemId };
  if (result.kind === "path-escape") return { kind: "path-escape" };
  if (result.kind === "not-found") return { kind: "item-not-found", id: result.itemId };
  return { kind: "ok", op: "delete", id: result.itemId };
}

async function updateViaView(
  deps: MutateRemoteViewDeps,
  store: CollectionStore,
  collection: LoadedCollection,
  view: CollectionCustomView,
  request: Extract<RemoteViewMutateRequest, { op: "update" }>,
): Promise<MutateRemoteViewResult> {
  const { write } = store;
  if (!write) return { kind: "read-only-collection" }; // unreachable: caller guards presence
  const { primaryKey } = collection.schema;
  const patchKeys = Object.keys(request.patch);
  if (patchKeys.length === 0) return { kind: "invalid-patch" };
  const allowed = new Set(view.editableFields ?? []);
  // The primary key is never patchable (it is the record id — renaming it would
  // desync the file name from the record) even if an author listed it.
  const offending = patchKeys.find((key) => key === primaryKey || !allowed.has(key));
  if (offending) return { kind: "field-not-editable", field: offending };
  // Classify a bad id BEFORE the store read — which returns null for an unsafe
  // id, a path-escape, AND a genuinely-missing record alike — so update reports
  // the same explicit `invalid-id` the delete path does (via `store.delete`)
  // instead of masking it as a 404. (A valid id whose data location escapes the
  // workspace can hold no record, so it still resolves to item-not-found; a
  // real write is additionally refused by the store's own containment guard.)
  if (safeRecordId(request.id) === null) return { kind: "invalid-id", id: request.id };
  const existing = await store.read(request.id);
  if (!existing) return { kind: "item-not-found", id: request.id };
  const merged: CollectionItem = { ...existing, ...request.patch, [primaryKey]: request.id };
  const result = await write(request.id, merged);
  if (result.kind === "invalid-id") return { kind: "invalid-id", id: result.itemId };
  if (result.kind === "path-escape") return { kind: "path-escape" };
  if (result.kind === "conflict") return { kind: "item-not-found", id: result.itemId }; // unreachable: refuseOverwrite is false
  // The returned item must be shaped like a `getItems` item — same host-computed
  // fields (derived, incl. ref-crossing, toggle, embed) AND the view's declared
  // image fields inlined as `data:` URLs — so a view that merges the result (as
  // the help file recommends) keeps its computed columns and doesn't clobber a
  // good thumbnail with a bare path. Enrich through the SAME resolver getItems
  // uses, then inline every declared image-type field (no projection here — the
  // whole record is returned). Budget the thumbnail against the serialized item
  // (same as the page builder) so a record with large text/markdown fields can't
  // push the mutate result over the command-document cap — over budget, the field
  // stays a path (placeholder), never a doc-write failure.
  // `enrichItems` maps 1:1, so the default is unreachable; it keeps the write's
  // own (un-enriched) record as the response rather than failing after a
  // successful persist.
  const [item = result.item] = await deps.enrichItems(collection, [result.item]);
  // Enrichment can inflate the base item (an `embed` attaches a whole target
  // record, a computed field a large payload). If the base JSON already exceeds
  // the doc budget, no thumbnail-skipping can save it — the write DID persist,
  // but return `too-large` (mirroring the getItems page cap) so the response
  // fails predictably/actionably here instead of downstream on the channel write.
  const baseBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
  if (baseBytes > REMOTE_VIEW_ITEMS_MAX_BYTES) return { kind: "too-large", bytes: baseBytes };
  const imageFields = inlineFields(view, collection.schema, undefined);
  if (imageFields.length > 0) {
    await inlineImages([item], imageFields, clampImageMaxEdge(view.imageMaxEdge), deps.resolveThumbnail, REMOTE_VIEW_ITEMS_MAX_BYTES - baseBytes);
  }
  return { kind: "ok", op: "update", item };
}

export const mutateRemoteView = createMutateRemoteView({ storeFor, enrichItems, resolveThumbnail });

// ── Item pages with inlined image thumbnails (phase 5 — plans/done/feat-remote-view-images.md) ──
// A mobile view's `getItems`, view-aware so it can inline the `imageFields` its
// declaration whitelists: derive computed fields → slice/project (the phase-2
// page semantics) → replace each declared image-type field's workspace path with
// a downscaled `data:` URL thumbnail, within a per-page byte budget so the 1 MiB
// command doc is never risked. Shared by the `getRemoteViewItems` channel handler
// (phone) and the `…/remote-view/:viewId/items` HTTP route (desktop preview).

export type RemoteViewItemsResult =
  | { kind: "ok"; page: RemoteViewPage; inlined: number; omitted: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "too-large"; bytes: number };

export interface RemoteViewItemsDeps {
  /** Load every record of the collection — store-aware (file records or a
   *  `dataSource` CSV's rows), unlike a raw dataDir `listItems`. */
  listRecords: (collection: LoadedCollection) => Promise<CollectionItem[]>;
  enrichItems: typeof enrichItems;
  resolveThumbnail: typeof resolveThumbnail;
}

/** The declared image fields that are actually inlineable this page: image-type
 *  in the schema AND kept by the request's `fields` projection (a projection
 *  that dropped the column ships no image bytes). A declared non-image field is
 *  ignored, not an error. */
function inlineFields(view: CollectionCustomView, schema: CollectionSchema, requested: string[] | undefined): string[] {
  const declared = view.imageFields ?? [];
  if (declared.length === 0) return [];
  const kept = requested ? new Set([schema.primaryKey, ...requested]) : null;
  return declared.filter((name) => schema.fields[name]?.type === "image" && (kept === null || kept.has(name)));
}

/** Replace declared image paths with thumbnail `data:` URLs in place, and say
 *  how many items were fully served before the byte budget ran out (#2924).
 *
 *  Running out of budget STOPS the walk rather than skipping the offending
 *  field and carrying on. That distinction is the whole fix: skipping meant a
 *  page came back with one arbitrary hole in it — the item whose thumbnail
 *  happened not to fit, while smaller ones after it still did — which reads as
 *  a corrupt record rather than as a page that was too heavy. The caller turns
 *  `fitted` into a SHORT PAGE instead, and the view pages on for the rest.
 *
 *  `omitted` survives for the one case a short page cannot express: a field
 *  that is unresolvable (missing file, unsupported format) rather than merely
 *  over budget. Those are skipped in place, as before — stopping on them would
 *  wedge the page at that item forever. */
async function inlineImages(items: RemoteViewItem[], fields: string[], maxEdge: number, resolve: typeof resolveThumbnail, budget: number): Promise<PageTotals> {
  const totals: PageTotals & { used: number } = { used: 0, inlined: 0, omitted: 0, served: 0 };
  for (const item of items) {
    const resolved = await resolveItemImages({ item, fields, maxEdge, resolve, remaining: budget - totals.used });
    // An item whose images do not all fit belongs to the NEXT page, so nothing
    // about it is committed: not its thumbnails, not its counts. The exception
    // is the FIRST item — dropping that one would return an empty page and the
    // view would ask for the same offset forever, so it goes out with whatever
    // fitted (the old placeholder degradation).
    if (resolved.overflowed && totals.served > 0) break;
    commitItem(item, resolved, totals);
    if (resolved.overflowed) break;
  }
  return { inlined: totals.inlined, omitted: totals.omitted, served: totals.served };
}

interface PageTotals {
  inlined: number;
  omitted: number;
  /** Items this page carries — what the caller slices to. */
  served: number;
}

/** Write one item's resolved thumbnails and fold its counts into the page's.
 *
 *  The write happens HERE, not during the walk, because an item that turns out
 *  not to fit is sliced away — and without a `fields` projection these are the
 *  store's own record objects, not copies. */
function commitItem(item: RemoteViewItem, resolved: ItemImages, totals: PageTotals & { used: number }): void {
  for (const [field, dataUrl] of resolved.thumbnails) item[field] = dataUrl;
  totals.used += resolved.bytes;
  totals.inlined += resolved.thumbnails.length;
  // Every image this page hands back as a PATH is counted, whatever the reason.
  // On a forced first item that includes ones that were merely over budget: it
  // is still a placeholder the author will see, and leaving it uncounted was the
  // one hole the no-hole guarantee did not cover (Codex on #2934). Deferred
  // items are not counted because they are not on this page.
  totals.omitted += resolved.unresolvable + resolved.deferred;
  // Counted because it is going out, overflowed or not — `served` is "what this
  // page carries", so the never-empty rule lives HERE and the caller just slices
  // to it. Splitting the two is how the guard gets lost (Sourcery on #2934).
  totals.served += 1;
}

/** Resolve one item's declared image fields against what is left of the budget,
 *  WITHOUT touching the item. The caller commits or discards the whole result,
 *  so an item can never go out half-inlined while its counters say otherwise
 *  (Codex + CodeRabbit on #2934).
 *
 *  `deferred` counts the fields left un-inlined once the budget ran out. It
 *  matters only for a forced first item, which goes out anyway: those fields
 *  travel as paths, and the caller counts them so nothing reaches the view as a
 *  placeholder without being reported. */
interface ItemImages {
  thumbnails: [string, string][];
  bytes: number;
  unresolvable: number;
  /** Fields left un-inlined once the budget ran out. */
  deferred: number;
  overflowed: boolean;
}

interface ItemImageRequest {
  item: RemoteViewItem;
  fields: string[];
  maxEdge: number;
  resolve: typeof resolveThumbnail;
  /** What is left of the page's byte budget. */
  remaining: number;
}

async function resolveItemImages({ item, fields, maxEdge, resolve, remaining }: ItemImageRequest): Promise<ItemImages> {
  const pending = pendingImageFields(item, fields);
  const thumbnails: [string, string][] = [];
  let bytes = 0;
  let unresolvable = 0;
  for (const [index, [field, path]] of pending.entries()) {
    const dataUrl = await resolve(path, maxEdge);
    // Not a budget problem, so a smaller page cannot fix it — ending the page
    // here would wedge paging at this item forever. Leave the path, keep going.
    if (dataUrl === null) {
      unresolvable += 1;
      continue;
    }
    // Over budget. Everything still pending — this field and the ones after it —
    // travels as a path, which the caller reports if the item is forced out.
    if (bytes + dataUrl.length > remaining) return { thumbnails, bytes, unresolvable, deferred: pending.length - index, overflowed: true };
    thumbnails.push([field, dataUrl]);
    bytes += dataUrl.length;
  }
  return { thumbnails, bytes, unresolvable, deferred: 0, overflowed: false };
}

/** The `(field, path)` pairs on `item` that still want inlining — absent, empty
 *  and already-inlined `data:` values are not among them.
 *
 *  Collected up front so the resolver can count what is left from its own
 *  position (`pending.length - index`) instead of re-scanning the record with a
 *  second copy of the same predicate (CodeRabbit on #2934). */
/** The stored path on `item.field` that still wants inlining, or null when the
 *  field holds nothing to inline — absent, empty, or an already-inlined `data:`
 *  URL. Named rather than inlined because it is the rule that decides what an
 *  "image to fetch" even is. */
function inlinablePath(item: RemoteViewItem, field: string): string | null {
  const value = item[field];
  return typeof value === "string" && value.length > 0 && !value.startsWith("data:") ? value : null;
}

function pendingImageFields(item: RemoteViewItem, fields: string[]): [string, string][] {
  const pending: [string, string][] = [];
  for (const field of fields) {
    const path = inlinablePath(item, field);
    if (path !== null) pending.push([field, path]);
  }
  return pending;
}

export const createRemoteViewItems =
  (deps: RemoteViewItemsDeps) =>
  async (collection: LoadedCollection, viewId: string, request: RemoteViewPageRequest): Promise<RemoteViewItemsResult> => {
    const resolved = resolveMobileView(collection, viewId);
    if (resolved.kind !== "ok") return resolved;
    const { view } = resolved;
    // Hydrate through the SAME server resolver the desktop `dataUrl` route uses
    // (manageCollection.getItems → enrichItems): ref targets loaded once, derived
    // formulas evaluated with a full ref cache (`ticker.price`, `shares * ticker.price`
    // resolve), toggles projected, embeds resolved. The phone gets plain resolved
    // scalars — no network, no dataUrl — so mobile numbers match desktop exactly.
    const items = await deps.listRecords(collection);
    const derived = await deps.enrichItems(collection, items);
    const page = pageFromItems(derived, request, collection.schema.primaryKey);
    // Resolving an `embed` column attaches a whole target record per row, so the
    // base (path-only) page JSON can itself blow the doc budget before a single
    // thumbnail is added. Reject with an actionable error rather than letting the
    // oversized doc fail downstream at the command-channel write.
    const baseBytes = Buffer.byteLength(JSON.stringify(page), "utf8");
    if (baseBytes > REMOTE_VIEW_ITEMS_MAX_BYTES) return { kind: "too-large", bytes: baseBytes };
    const fields = inlineFields(view, collection.schema, request.fields);
    if (fields.length === 0) return { kind: "ok", page, inlined: 0, omitted: 0 };
    // Budget the thumbnails against what's left of the doc after the base JSON,
    // so the serialized page stays under the cap.
    const budget = REMOTE_VIEW_ITEMS_MAX_BYTES - baseBytes;
    const { inlined, omitted, served } = await inlineImages(
      page.items,
      fields,
      clampImageMaxEdge(view.imageMaxEdge),
      deps.resolveThumbnail,
      Math.max(0, budget),
    );
    return { kind: "ok", page: truncateToServed(page, served), inlined, omitted };
  };

/** Cut the page down to the items `inlineImages` served, so the rest travel on
 *  the NEXT page with their thumbnails intact (#2924).
 *
 *  `total` is deliberately untouched: it counts the records behind the view, not
 *  the ones on this page, and it is what the documented paging idiom stops on
 *  (`loaded.length >= total` — see `custom-view-remote.md`). `limit` reports what
 *  was actually returned, so a view advancing by the RESPONSE's limit is also
 *  correct; the idiom advances by `items.length`, which is correct either way.
 *
 *  No never-empty guard here: `served` is already "what this page carries", and
 *  it is zero only when the page had no items to begin with (an offset past the
 *  end), where an empty page is the right answer. */
function truncateToServed(page: RemoteViewPage, served: number): RemoteViewPage {
  if (served >= page.items.length) return page;
  const items = page.items.slice(0, served);
  return { ...page, items, limit: items.length };
}

export const remoteViewItems = createRemoteViewItems({ listRecords: (collection) => storeFor(collection).list(), enrichItems, resolveThumbnail });

/** Message per non-ok item-page kind — shared by the channel handler (throws)
 *  and the HTTP route (sends with the matching status). */
export function remoteViewItemsFailureMessage(result: Exclude<RemoteViewItemsResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "too-large")
    return `mobile view page is ${result.bytes} bytes — over the ${REMOTE_VIEW_ITEMS_MAX_BYTES}-byte command-channel budget; narrow \`fields\` (drop an embed column), lower \`limit\`, or slim the records`;
  return `custom view '${result.viewId}' not found on collection '${slug}'`;
}

/** Message per non-ok mutate kind — shared by the channel handler (throws) and
 *  the HTTP route (sends with the matching status). */
export function mutateRemoteViewFailureMessage(result: Exclude<MutateRemoteViewResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "view-not-found") return `custom view '${result.viewId}' not found on collection '${slug}'`;
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "not-writable")
    return `mobile view '${result.viewId}' is read-only — declare editableFields and/or allowDelete in its views[] entry to allow writes`;
  if (result.kind === "read-only-collection")
    return `collection '${slug}' is read-only (backed by an external dataSource) — update the data file itself instead`;
  if (result.kind === "field-not-editable")
    return `field '${result.field}' is not editable from this view — add it to the view's editableFields (the primary key is never editable)`;
  if (result.kind === "delete-not-allowed") return `this view may not delete records — set allowDelete: true in its views[] entry`;
  if (result.kind === "invalid-patch") return `update patch must be a non-empty object of field changes`;
  if (result.kind === "item-not-found") return `item '${result.id}' not found in collection '${slug}'`;
  if (result.kind === "invalid-id") return `invalid item id: ${result.id}`;
  if (result.kind === "too-large")
    return `update succeeded but its response is ${result.bytes} bytes — over the ${REMOTE_VIEW_ITEMS_MAX_BYTES}-byte command-channel budget; slim the record (an embed/computed field is too big) and re-fetch with \`getItems\``;
  return `data directory for collection '${slug}' escapes the workspace`;
}
