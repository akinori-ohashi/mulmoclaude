// Keeps pinned launcher shortcuts for collections that declare a
// `dynamicIcon` (see `CollectionSchema.dynamicIcon`) live: subscribes to
// each dynamic collection's source collection(s) and re-reconciles the
// shortcut cache whenever their records change, so the launcher icon
// tracks the data state live instead of waiting for the next
// Collections-index visit — `CollectionsIndexView`'s own reconcile-on-mount
// remains the fallback for a cold boot, before this composable's first
// fetch resolves.
//
// Mounted once at app level (src/App.vue) so it runs regardless of
// whether the Collections index is open. Module-singleton state, like
// `useShortcuts` — there's only ever one launcher to keep live.

import { onMounted, onUnmounted, ref } from "vue";
import { collectionUi } from "@mulmoclaude/collection-plugin/vue";
import { useShortcuts } from "../useShortcuts";
import { collectionShortcutRows } from "./collectionShortcutRows";
import type { CollectionSummary } from "@mulmoclaude/core/collection";

/** Wait for a burst of source-collection changes to settle (e.g. a feed
 *  refresh writing several records) before re-fetching, rather than
 *  re-fetching per record. */
const SOURCE_CHANGE_DEBOUNCE_MS = 300;

type Unsubscribe = () => void;

const summaries = ref<CollectionSummary[]>([]);
let subscriptions: Unsubscribe[] = [];
let debounceHandle: ReturnType<typeof setTimeout> | null = null;
let refreshSeq = 0;

/** Slugs of every source collection a dynamic-icon shortcut watches,
 *  deduped (two dynamic collections can share a source). */
function dynamicSourceSlugs(): string[] {
  const slugs = new Set<string>();
  for (const summary of summaries.value) {
    for (const source of summary.iconSources ?? []) slugs.add(source);
  }
  return [...slugs];
}

function clearSubscriptions(): void {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  subscriptions = [];
}

/** Re-derive the watched source-collection set from the current
 *  `summaries` and (re)subscribe — so a newly-added dynamic collection
 *  gets watched on the next refresh. A host without `subscribeChanges`
 *  (no pub/sub transport) leaves this a no-op; v1's reconcile-on-visit
 *  still applies. */
function resubscribe(): void {
  clearSubscriptions();
  const subscribe = collectionUi().subscribeChanges;
  if (!subscribe) return;
  subscriptions = dynamicSourceSlugs().map((slug) => subscribe(slug, scheduleRefresh));
}

function scheduleRefresh(): void {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    debounceHandle = null;
    void refresh();
  }, SOURCE_CHANGE_DEBOUNCE_MS);
}

/** Fetch the authoritative collections list, reconcile pinned
 *  `"collection"` shortcuts against it, and re-derive which source
 *  collections to watch. Feed-source entries are excluded — they're
 *  reconciled separately (kind `"feed"`) by `FeedsView`. A failed fetch
 *  leaves the prior summaries (and subscriptions) untouched. A monotonic
 *  `refreshSeq` drops a superseded fetch so a slow older `listCollections`
 *  can't resolve last and overwrite fresher summaries / resubscribe stale. */
async function refresh(): Promise<void> {
  const seq = ++refreshSeq;
  const result = await collectionUi().listCollections();
  if (seq !== refreshSeq) return;
  if (!result.ok) return;
  summaries.value = result.data.collections.filter((summary) => summary.source !== "feed");
  resubscribe();
  await useShortcuts().reconcile("collection", collectionShortcutRows(summaries.value));
}

/** Mount once at app level. No template — side effects only. */
export function useDynamicShortcutIcons(): void {
  onMounted(() => void refresh());
  onUnmounted(() => {
    if (debounceHandle) clearTimeout(debounceHandle);
    clearSubscriptions();
  });
}
