<template>
  <span class="shrink-0 inline-flex items-center gap-1">
    <select
      v-model="draft"
      class="appearance-none bg-transparent border-0 p-0 pr-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
      :class="override ? 'text-blue-600 font-semibold' : 'text-gray-500 font-medium'"
      :title="tooltip"
      :aria-label="t('sessionModelChip.ariaLabel')"
      data-testid="session-model-chip"
      @change="onChange"
    >
      <!-- Rendered unconditionally: as a display (#2554) an empty slot was the
           honest thing to show before the first turn reported a model, but this
           is now the only control for the override (#3147) and hiding it took
           away the first message — the moment a per-chat model is most worth
           choosing. Whether a session is open at all is the parent's question,
           and both parents already answer it for the role name beside this.
           The effective model is the label on the "no override" option, so the
           closed select reads as the current state rather than as an empty
           control. That is the whole chip's job (#2554) and it has to survive
           becoming a picker (#3147).
           It is marked as INHERITED because the other options are aliases the
           user picks, while this one is a resolved id the CLI reported — a list
           holding both "Haiku 4.5" and "haiku" unlabelled reads as two models. -->
      <option value="">{{ label ? t("sessionModelChip.inherited", { model: label }) : t("sessionModelChip.unknown") }}</option>
      <option v-for="choice in CHAT_MODELS" :key="choice" :value="choice">{{ choice }}</option>
    </select>
    <button
      v-if="override"
      type="button"
      class="text-xs text-gray-400 hover:text-gray-700"
      :title="t('sessionModelChip.clear')"
      :aria-label="t('sessionModelChip.clear')"
      data-testid="session-model-chip-clear"
      @click="clear"
    >
      <span class="material-icons text-xs leading-none" aria-hidden="true">close</span>
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatModelLabel } from "../utils/format/modelLabel";
import { CHAT_MODELS, type ChatModel } from "../config/models";

const { t } = useI18n();

const props = defineProps<{
  /** Raw id the CLI reported for this session — an OBSERVATION. Undefined
   *  before the first turn has reported one. */
  model?: string | undefined;
  /** This conversation's one-off override — a CHOICE. Undefined means the role
   *  or the app-wide setting decides (#3147). */
  override?: ChatModel | undefined;
}>();

const emit = defineEmits<{
  "update:override": [ChatModel | undefined];
}>();

const label = computed(() => formatModelLabel(props.model));
const draft = ref<ChatModel | "">(props.override ?? "");

// The prop is the source of truth, not `draft`: a reload re-reads the value
// from session meta, and a rejected write rolls the parent's copy back under
// this component. (A change made in ANOTHER tab does not arrive until that
// tab's next reload — the sessions list the other tab refreshes from carries
// no `chatModel`. Tracked separately; see the PR.)
watch(
  () => props.override,
  (next) => {
    draft.value = next ?? "";
  },
);

const tooltip = computed(() =>
  props.override ? t("sessionModelChip.tooltipOverride", { model: props.override }) : t("sessionModelChip.tooltip", { model: props.model ?? "" }),
);

const onChange = (): void => {
  emit("update:override", draft.value === "" ? undefined : draft.value);
};

const clear = (): void => {
  draft.value = "";
  emit("update:override", undefined);
};
</script>
