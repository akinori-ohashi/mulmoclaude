<template>
  <!-- Reorder affordance for the pinned-shortcut pill. Rendered as a
       sibling AFTER the Group 2 pill (not inside it) — that pill is
       `overflow-x-auto`, which would clip an absolute popover. Its own
       `relative` wrapper hosts the panel so it can overflow freely. Only
       mounted when there are at least two shortcuts to order. -->
  <div ref="wrapper" class="relative inline-flex flex-none">
    <button
      ref="trigger"
      type="button"
      class="h-8 w-8 flex items-center justify-center border border-gray-300 rounded bg-white text-gray-600 hover:bg-gray-50 transition-colors"
      :class="{ 'bg-blue-50 text-blue-600': open }"
      :title="t('shortcuts.reorder.open')"
      :aria-label="t('shortcuts.reorder.open')"
      :aria-expanded="open"
      aria-haspopup="true"
      data-testid="shortcut-reorder-open"
      @click="open = !open"
    >
      <span class="material-icons text-base">edit</span>
    </button>

    <div
      v-if="open"
      ref="panel"
      class="absolute right-0 top-full mt-1 z-50 w-64 max-w-[80vw] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
      role="dialog"
      :aria-label="t('shortcuts.reorder.title')"
      data-testid="shortcut-reorder-panel"
    >
      <div class="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">
        {{ t("shortcuts.reorder.title") }}
      </div>
      <ul class="max-h-64 overflow-y-auto py-1 [scrollbar-width:thin]">
        <li
          v-for="(shortcut, index) in shortcuts"
          :key="`${shortcut.kind}:${shortcut.slug}`"
          class="flex items-center gap-2 px-3 py-1 text-sm text-gray-900"
          :data-testid="`shortcut-reorder-row-${shortcut.kind}-${shortcut.slug}`"
        >
          <span class="h-6 w-6 rounded flex items-center justify-center flex-none" :class="accentChipClasses(shortcut.color) ?? 'text-gray-500'">
            <IconGlyph :icon="shortcut.icon" size-class="text-base" />
          </span>
          <span class="flex-1 truncate" :title="shortcut.title">{{ shortcut.title }}</span>
          <button
            type="button"
            class="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            :title="t('shortcuts.reorder.moveUp')"
            :aria-label="t('shortcuts.reorder.moveUp')"
            :disabled="index === 0"
            :data-testid="`shortcut-reorder-up-${shortcut.kind}-${shortcut.slug}`"
            @click="move(shortcut, 'up')"
          >
            <span class="material-icons text-base">arrow_upward</span>
          </button>
          <button
            type="button"
            class="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            :title="t('shortcuts.reorder.moveDown')"
            :aria-label="t('shortcuts.reorder.moveDown')"
            :disabled="index === shortcuts.length - 1"
            :data-testid="`shortcut-reorder-down-${shortcut.kind}-${shortcut.slug}`"
            @click="move(shortcut, 'down')"
          >
            <span class="material-icons text-base">arrow_downward</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { IconGlyph } from "@mulmoclaude/core/plugin-vue";
import { accentChipClasses } from "@mulmoclaude/core/collection";
import { useShortcuts } from "../composables/useShortcuts";
import { useClickOutside } from "../composables/useClickOutside";
import type { MoveDirection } from "../composables/shortcutReorder";
import type { Shortcut } from "../types/shortcuts";

const { t } = useI18n();
const { shortcuts, movePinned } = useShortcuts();

const open = ref(false);
const wrapper = ref<HTMLDivElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLDivElement | null>(null);

// Pass the move INTENT (identity + direction), not a precomputed array:
// the store resolves the new order against the authoritative list when
// the queued mutation runs, so rapid clicks compose even while the queue
// is busy behind a reconcile.
async function move(shortcut: Shortcut, direction: MoveDirection): Promise<void> {
  await movePinned(shortcut.kind, shortcut.slug, direction);
}

const { handler } = useClickOutside({ isOpen: open, buttonRef: trigger, popupRef: panel });

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) open.value = false;
}

onMounted(() => {
  document.addEventListener("mousedown", handler);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handler);
  document.removeEventListener("keydown", onKeydown);
});
</script>
