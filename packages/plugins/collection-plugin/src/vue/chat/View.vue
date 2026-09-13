<template>
  <div class="w-full h-full" data-testid="present-collection">
    <CollectionView
      v-if="slug"
      :key="viewKey"
      :slug="slug"
      :selected="selected"
      :initial-view="viewState?.view"
      :initial-anchor-field="viewState?.anchorField"
      :initial-group-field="viewState?.groupField"
      :send-text-message="sendTextMessage"
      @select="onSelect"
      @view-state-change="onViewStateChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import CollectionView from "../components/CollectionView.vue";
import { collectionCardKey, type PresentCollectionData } from "@mulmoclaude/core/collection";
import { toPresentCollectionData } from "./presentCollectionData";
import { toViewState, type PresentCollectionViewState } from "./presentCollectionViewState";
import type { CollectionViewMode } from "../collectionViewMode";
import { provideCollectionScope } from "../scopedUi";

const props = defineProps<{
  selectedResult: ToolResult | null;
  /** Host-provided channel into the current chat session. Forwarded to
   *  CollectionView so its chat actions send a message here instead of
   *  spawning a new chat (the card is always rendered inside a chat). */
  sendTextMessage?: (text?: string) => void;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult];
}>();

const data = computed<PresentCollectionData | null>(() => toPresentCollectionData(props.selectedResult?.data ?? props.selectedResult?.jsonData));

const slug = computed<string | undefined>(() => data.value?.collectionSlug);

// A collection's identity is (root, slug), and this card names both: the host
// stamped the project it was made in onto the payload. Bind the card's subtree
// to it so its fetches address THAT project rather than whichever one happens to
// be ambient when the card renders. Absent — the single-workspace case, and every
// card produced before the field existed — this is the global binding, unchanged.
provideCollectionScope(() => data.value?.scope);

// A collection's identity is (root, slug), so the mounted view's identity has to
// be both. Keyed on the slug alone, a card switched to the SAME slug in another
// project keeps the mounted view — which reloads only when its slug changes — so
// it would go on showing project A's records while every write resolved through
// project B's binding. The key is `collectionCardKey`, the same identity the host
// reconciles cards by. Unscoped, it is the slug: one root, and remounting on a
// slug change is what the view already did.
const viewKey = computed<string>(() => (data.value === null ? "" : collectionCardKey(data.value)));

const viewState = computed<PresentCollectionViewState | null>(() => toViewState(props.selectedResult?.viewState));

/** Open record: the card-local `viewState.selected` once the user has
 *  navigated within the card (including an explicit close → null), else
 *  the tool's initial `itemId`. */
const selected = computed<string | undefined>(() => {
  const state = viewState.value;
  if (state && "selected" in state) return state.selected ?? undefined;
  return data.value?.itemId;
});

function onSelect(itemId: string | null): void {
  if (!props.selectedResult) return;
  emit("updateResult", { ...props.selectedResult, viewState: { ...viewState.value, selected: itemId } });
}

function onViewStateChange(state: { view: CollectionViewMode; anchorField: string; groupField: string }): void {
  if (!props.selectedResult) return;
  // Skip redundant writes (the anchor/group settling on load fires this once).
  const current = viewState.value;
  if (current?.view === state.view && current?.anchorField === state.anchorField && current?.groupField === state.groupField) return;
  emit("updateResult", {
    ...props.selectedResult,
    viewState: { ...current, view: state.view, anchorField: state.anchorField, groupField: state.groupField },
  });
}
</script>
