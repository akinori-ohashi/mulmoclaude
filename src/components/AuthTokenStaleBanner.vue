<template>
  <StatusBanner
    v-if="authTokenStale"
    tone="warning"
    icon="sync_disabled"
    testid="auth-token-stale-banner"
    action-testid="auth-token-stale-reload"
    :title="t('authTokenStale.title')"
    :body="t('authTokenStale.body')"
    :action-label="t('authTokenStale.reload')"
    @action="reload"
  />
</template>

<script setup lang="ts">
// Shown once the server refused this page's token and fetching index.html
// again did not produce one it accepts (#3438). Auto-recovery is the normal
// path after a server restart; this is its last resort, and a reload is the
// only thing left that fetches a fresh token.
import { useI18n } from "vue-i18n";
import StatusBanner from "./StatusBanner.vue";
import { authTokenStale } from "../utils/auth/authTokenRecovery";

const { t } = useI18n();

const reload = (): void => window.location.reload();
</script>
