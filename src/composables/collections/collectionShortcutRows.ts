import { toShortcutInfo, type CollectionShortcutInfo, type CollectionSummary } from "@mulmoclaude/core/collection";

/** Collection summaries as shortcut-reconcile rows — the same mapping (and
 *  fallback icon) `CollectionsIndexView` uses, so a startup reconcile and an
 *  index visit agree and neither strips what the other wrote. */
export function collectionShortcutRows(summaries: CollectionSummary[]): CollectionShortcutInfo[] {
  return summaries.map((summary) => toShortcutInfo(summary, "dataset"));
}
