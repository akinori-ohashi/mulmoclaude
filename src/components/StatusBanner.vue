<template>
  <div :data-testid="testid" role="alert" class="flex items-center gap-2 px-3 py-2 border-b text-sm" :class="palette.root">
    <span class="material-icons text-base" aria-hidden="true">{{ icon }}</span>
    <div class="flex-1 min-w-0">
      <div class="font-medium">{{ title }}</div>
      <div class="text-xs truncate" :class="palette.body">
        <span>{{ body }}</span>
        <span v-if="detail" class="opacity-70">{{ ` — ${detail}` }}</span>
      </div>
    </div>
    <button
      type="button"
      :data-testid="actionTestid"
      class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border disabled:opacity-40"
      :class="palette.button"
      :disabled="busy"
      @click="emit('action')"
    >
      <span class="material-icons text-sm" :class="busy ? 'animate-spin' : ''" aria-hidden="true">refresh</span>
      {{ actionLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
// The one chrome for a page-wide status notice pinned above the top bar: an
// icon, a title, one line of body with optional small print, and one action.
// The wrapper that mounts it owns the signal (`v-if`) and the action.
import { computed } from "vue";

const PALETTES = {
  error: {
    root: "bg-red-50 border-red-200 text-red-700",
    body: "text-red-600",
    button: "border-red-300 text-red-700 hover:bg-red-100",
  },
  warning: {
    root: "bg-amber-50 border-amber-200 text-amber-800",
    body: "text-amber-700",
    button: "border-amber-300 text-amber-800 hover:bg-amber-100",
  },
} as const;

const props = withDefaults(
  defineProps<{
    tone: keyof typeof PALETTES;
    /** A Material Icons name. */
    icon: string;
    title: string;
    body: string;
    /** Small print after the body, rendered dimmer. */
    detail?: string | null;
    actionLabel: string;
    /** Disables the action and spins its icon. */
    busy?: boolean;
    testid: string;
    actionTestid: string;
  }>(),
  { detail: null, busy: false },
);

const emit = defineEmits<{ action: [] }>();

const palette = computed(() => PALETTES[props.tone]);
</script>
