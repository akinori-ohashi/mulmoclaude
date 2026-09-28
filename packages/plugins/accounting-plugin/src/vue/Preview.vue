<template>
  <!-- Compact inline summary for a tool result that is not the openBook
       envelope, which routes to View.vue (the full app) instead.
       WHICH actions reach here is decided by PREVIEW_ACTIONS in
       server/router.ts and asserted by its tests — deliberately not listed
       again here, because a second copy of that list is what went stale
       three times in #2716's review. -->
  <div class="text-sm text-gray-700" data-testid="accounting-preview">
    <span class="material-icons text-base align-middle mr-1">account_balance</span>
    <span>{{ summary }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useAccountingI18n } from "./lang";
import { summarisePreview } from "./previewSummary";

const { t } = useAccountingI18n();

// `result` is what SessionSidebar hands every previewComponent, and the only
// thing it hands them. This component declared `data` / `jsonData` instead and
// so never received a payload at all (#2716) — the props of a dynamic
// `<component :is>` are not typechecked, so nothing caught it.
const props = defineProps<{ result: ToolResultComplete }>();

const summary = computed<string>(() => summarisePreview(props.result.data, t));
</script>
