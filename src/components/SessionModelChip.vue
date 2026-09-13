<template>
  <span
    v-if="label"
    class="shrink-0 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium tabular-nums"
    :title="t('sessionModelChip.tooltip', { model: model ?? '' })"
    data-testid="session-model-chip"
  >
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatModelLabel } from "../utils/format/modelLabel";

const { t } = useI18n();

// The raw id the CLI reported for this session. Undefined before the first
// turn has reported one, which is why the chip renders nothing rather than a
// placeholder — an empty slot is honest, "unknown" would not be.
const props = defineProps<{
  model?: string | undefined;
}>();

const label = computed(() => formatModelLabel(props.model));
</script>
