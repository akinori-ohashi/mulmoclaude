<script setup lang="ts">
/**
 * Installs the runtime for the light-DOM case.
 *
 * `provide` reaches descendants, not the component that calls it, so the runtime has to come
 * from a PARENT of the View — calling `provide` beside it in App.vue throws
 * "useRuntime() called outside of <PluginScopedRoot>". The Shadow DOM case installs it on its
 * own app instead (see ShadowFrame), which is how a host does it per plugin.
 */
import { provide } from "vue";
import { PLUGIN_RUNTIME_KEY, type BrowserPluginRuntime } from "gui-chat-protocol/vue";

const props = defineProps<{ runtime: BrowserPluginRuntime }>();
provide(PLUGIN_RUNTIME_KEY, props.runtime);
</script>

<template>
  <slot />
</template>
