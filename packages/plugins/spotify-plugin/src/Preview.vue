<script setup lang="ts">
// Compact summary shown in the session sidebar for a `manageSpotify` result,
// so the user can see what came back without opening the canvas. The full View
// opens on click via the parent's standard "open in canvas" affordance.

import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useT } from "./lang";
import { summarisePreview } from "./previewSummary";

// `result` is what SessionSidebar hands every previewComponent, and the only
// thing it hands them. This component declared `selectedResult` — the prop the
// VIEW slot takes — so it arrived undefined and the computed threw on
// `result.ok` (#3226). The props of a dynamic `<component :is>` are not
// typechecked, so nothing caught it.
const props = defineProps<{ result: ToolResultComplete }>();
const t = useT();

const summary = computed<string>(() => summarisePreview(props.result.data, t.value));
</script>

<template>
  <div class="spotify-preview">
    <span class="spotify-preview-icon" aria-hidden="true">♪</span>
    <span class="spotify-preview-label">{{ t.previewSummary }}</span>
    <span class="spotify-preview-summary">{{ summary }}</span>
  </div>
</template>

<style scoped>
.spotify-preview {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  background: #f5f5f5;
  font-size: 0.875rem;
}
.spotify-preview-icon {
  color: #1ed760;
  font-weight: 600;
}
.spotify-preview-label {
  font-weight: 500;
}
.spotify-preview-summary {
  color: #6b7280;
  font-size: 0.75rem;
}
</style>
