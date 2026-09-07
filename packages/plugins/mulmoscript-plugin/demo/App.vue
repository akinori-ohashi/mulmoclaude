<script setup lang="ts">
/**
 * Standalone harness for the presentMulmoScript View.
 *
 * Two toggles, because the two things that are hard to judge from the code are both about
 * where the component ends up rather than what it renders:
 *
 *  - **width** — the editor lays itself out from its own width now (no `layout` prop), and the
 *    plugin card in MulmoTerminal is narrow. 600px is that card; "wide" is the desktop case.
 *  - **shadow** — the plugin really mounts inside a Shadow DOM with only its own bundled CSS.
 *    A stylesheet appended to `document.head` at runtime does not cross that boundary.
 */
import { computed, ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import View from "../src/vue/View.vue";
import { createRuntimeStub } from "./runtimeStub";
import { sampleDeck } from "./sampleDeck";
import RuntimeProvider from "./RuntimeProvider.vue";
import ShadowFrame from "./ShadowFrame.vue";
// The BUILT stylesheet, which is what the host injects into the shadow root — not the
// source one. `src/style.css` is `@import "tailwindcss"` and carries no utilities until
// Vite compiles it, so injecting that put the editor in a shadow root with no rules at all:
// the container query never applied, the pane took 498px of 589px, and the slide preview
// was clipped to 91px.
//
// `dist/` is gitignored, so `predev` builds it first — without that a fresh clone answers
// 500 for this import, measured.
import pluginCss from "../dist/style.css?inline";

// The transport hands the WHOLE envelope back as `data` (`transport.ts` returns
// `{ ok: true, data: result }`), so each kind's payload sits beside `ok` rather than under a
// `data` key. Measured: nesting it threw `pending.data.pending is not iterable` on mount.
const DISPATCH_RESULTS: Record<string, object> = {
  pendingGenerations: { pending: [] },
};

const { runtime, calls } = createRuntimeStub((args) => {
  const kind = (args as { kind?: string }).kind ?? "";
  return { ok: true, ...(DISPATCH_RESULTS[kind] ?? {}) };
});

const NARROW_PX = 600;
const narrow = ref(true);
const inShadow = ref(true);

const result = ref({
  uuid: "demo-mulmoscript",
  status: "complete",
  data: { filePath: "/demo/deck.json", script: sampleDeck },
} as unknown as ToolResultComplete<never>);

const frameStyle = computed(() => (narrow.value ? { width: `${NARROW_PX}px` } : { width: "100%" }));
const dispatched = computed(() => calls.map((c) => c.kind));
</script>

<template>
  <div class="min-h-screen bg-gray-100 p-6 space-y-4">
    <header class="space-y-2">
      <h1 class="text-xl font-bold text-gray-900">presentMulmoScript — deck editor</h1>
      <div class="flex gap-4 text-sm text-gray-700">
        <label class="flex items-center gap-2">
          <input v-model="narrow" type="checkbox" />
          narrow ({{ NARROW_PX }}px — the plugin card)
        </label>
        <label class="flex items-center gap-2">
          <input v-model="inShadow" type="checkbox" />
          inside a Shadow DOM (how the host mounts it)
        </label>
      </div>
      <p class="text-xs text-gray-500">dispatched: {{ dispatched.length ? dispatched.join(", ") : "(nothing yet)" }}</p>
    </header>

    <div :style="frameStyle" class="h-[720px] rounded-lg border border-gray-300 bg-white overflow-hidden">
      <ShadowFrame
        v-if="inShadow"
        :key="`shadow-${narrow}`"
        :css="pluginCss"
        :runtime="runtime"
        :component="View"
        :component-props="{ selectedResult: result }"
      />
      <RuntimeProvider v-else :runtime="runtime">
        <View :selected-result="result" />
      </RuntimeProvider>
    </div>
  </div>
</template>
