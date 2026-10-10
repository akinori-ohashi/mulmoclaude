<template>
  <StatusBanner
    v-if="!backendReachable"
    tone="error"
    icon="cloud_off"
    testid="backend-offline-banner"
    action-testid="backend-offline-retry"
    :title="t('backendOffline.title')"
    :body="t('backendOffline.body')"
    :detail="lastBackendError"
    :action-label="t('backendOffline.retry')"
    :busy="retrying"
    @action="retry"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import StatusBanner from "./StatusBanner.vue";
import { backendReachable, lastBackendError } from "../utils/api";

const { t } = useI18n();

const props = defineProps<{
  /** Health-check function injected by the parent (uses the shared
   *  `useHealth` instance so we don't spin up a second poll loop). */
  onRetry: () => Promise<void>;
}>();

const retrying = ref(false);

async function retry(): Promise<void> {
  if (retrying.value) return;
  retrying.value = true;
  try {
    // `fetchHealth` hits `/api/health` through `apiCall`, which on
    // success automatically flips `backendReachable` back to true.
    // We don't need to manage that ourselves.
    await props.onRetry();
  } finally {
    retrying.value = false;
  }
}
</script>
