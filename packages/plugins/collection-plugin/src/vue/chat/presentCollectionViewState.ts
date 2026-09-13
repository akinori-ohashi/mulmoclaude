// The host hands a tool result's `viewState` back through untyped, so the card
// reads its own restore state out field by field instead of trusting whatever
// wrote it — same shape as `presentCollectionData.ts`, and pure so the accepted
// set of modes is testable without mounting the card.

import { isCollectionViewMode, type CollectionViewMode } from "../collectionViewMode";

/** Card-local UI state persisted in the tool result's `viewState` so it
 *  survives a re-render — same pattern as presentForm. `selected` is the
 *  open record (`null` once explicitly closed); `view` / `anchorField` /
 *  `groupField` keep the table↔calendar↔kanban↔custom choice and its axes
 *  sticky.
 *  NOTE: the table sort is deliberately NOT here — it's a single shared
 *  per-collection preference in localStorage (read+written by both the
 *  standalone page and chat cards), so it stays consistent everywhere. */
export interface PresentCollectionViewState {
  selected?: string | null;
  view?: CollectionViewMode;
  anchorField?: string;
  groupField?: string;
}

/** Keep a field only when the stored value still matches what the interface
 *  declares, so `"selected" in state` keeps meaning "the user navigated".
 *  `view` accepts any `custom:<id>` the same way the localStorage store does:
 *  an id no longer declared on the schema collapses to the table at render
 *  time (`resolveActiveViewMode`), so a stale one is safe to carry. */
export function toViewState(value: unknown): PresentCollectionViewState | null {
  if (typeof value !== "object" || value === null) return null;
  const state: PresentCollectionViewState = {};
  if ("selected" in value && (typeof value.selected === "string" || value.selected === null)) state.selected = value.selected;
  if ("view" in value && isCollectionViewMode(value.view)) state.view = value.view;
  if ("anchorField" in value && typeof value.anchorField === "string") state.anchorField = value.anchorField;
  if ("groupField" in value && typeof value.groupField === "string") state.groupField = value.groupField;
  return state;
}
