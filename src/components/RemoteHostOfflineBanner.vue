<template>
  <StatusBanner
    v-if="needsReconnect"
    tone="warning"
    icon="phonelink_off"
    testid="remote-host-offline-banner"
    action-testid="remote-host-offline-reconnect"
    :title="t('remoteHostOffline.title')"
    :body="t('remoteHostOffline.body')"
    :action-label="t('remoteHostOffline.reconnect')"
    :busy="busy"
    @action="reconnect"
  />
</template>

<script setup lang="ts">
// Persistent banner shown when the remote host was meant to be connected but has
// dropped and a silent auto-reconnect couldn't restore it (e.g. the parked
// session expired). Reads the shared `useRemoteHost` store; Reconnect re-runs the
// Google sign-in popup from this click (a user gesture, so the popup isn't blocked).
import { useI18n } from "vue-i18n";
import StatusBanner from "./StatusBanner.vue";
import { useRemoteHost } from "../composables/useRemoteHost";

const { t } = useI18n();
const { needsReconnect, busy, connect } = useRemoteHost();

const reconnect = (): Promise<void> => connect();
</script>
