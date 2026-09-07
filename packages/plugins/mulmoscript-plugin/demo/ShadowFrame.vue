<script setup lang="ts">
/**
 * The plugin's real mounting condition: a Shadow DOM, with only the plugin's own CSS inside.
 *
 * MulmoTerminal mounts every plugin this way (`PluginFrame.vue` → `attachShadow({ mode: "open" })`)
 * and injects the plugin's compiled stylesheet into the shadow root. A stylesheet the component
 * appends to `document.head` at runtime does NOT cross that boundary — which is exactly the
 * question this demo exists to answer, so the toggle has to reproduce it faithfully.
 *
 * A shadow root is a separate tree, so the content is mounted as its own Vue app rather than
 * teleported: `provide`/`inject` walks the component chain, and re-rendering a slot into a
 * detached container breaks that chain. The runtime is therefore installed on the app created
 * here, exactly as a host installs it per plugin.
 */
import { createApp, onBeforeUnmount, onMounted, ref, type App, type Component } from "vue";
import { PLUGIN_RUNTIME_KEY, type BrowserPluginRuntime } from "gui-chat-protocol/vue";

/** Copied from the host's PluginFrame so the demo shows what a user actually sees. */
const ICON_ALIAS_CSS = `
.material-icons,
.material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
}`;

const props = defineProps<{ css: string; runtime: BrowserPluginRuntime; component: Component; componentProps: Record<string, unknown> }>();

const host = ref<HTMLDivElement | null>(null);
let mounted: App | null = null;

onMounted(() => {
  const element = host.value;
  if (!element) return;
  const shadow = element.attachShadow({ mode: "open" });
  // The host aliases the icon classes inside every plugin's shadow root
  // (`PluginFrame.vue` → MATERIAL_ICONS_SHADOW_CSS); without it `content_copy` renders as
  // the literal word. The @font-face itself is registered on the document by main.ts —
  // a shadow root cannot register one.
  const iconStyle = document.createElement("style");
  iconStyle.textContent = ICON_ALIAS_CSS;
  shadow.appendChild(iconStyle);
  const style = document.createElement("style");
  style.textContent = props.css;
  shadow.appendChild(style);
  const mount = document.createElement("div");
  // The host gives the isolated frame a light surface; match it so colours read the same.
  mount.style.cssText = "background:#ffffff;color:#111827;height:100%;overflow:hidden";
  shadow.appendChild(mount);
  mounted = createApp(props.component, props.componentProps);
  mounted.provide(PLUGIN_RUNTIME_KEY, props.runtime);
  mounted.mount(mount);
});

onBeforeUnmount(() => {
  mounted?.unmount();
  mounted = null;
});
</script>

<template>
  <div ref="host" class="h-full"></div>
</template>
