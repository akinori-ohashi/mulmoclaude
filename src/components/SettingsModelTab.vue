<template>
  <div class="space-y-3" data-testid="settings-model-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.modelTab.description") }}</p>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-800" for="settings-model-chat-model">{{ t("settingsModal.modelTab.modelLabel") }}</label>
      <select
        id="settings-model-chat-model"
        v-model="modelDraft"
        class="w-full px-3 py-2 text-sm rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        data-testid="settings-model-model-select"
        @change="save(modelField)"
      >
        <option value="">{{ t("settingsModal.modelTab.modelUnset") }}</option>
        <option v-for="model in CHAT_MODELS" :key="model" :value="model">{{ model }}</option>
      </select>
      <p class="text-xs text-gray-500">{{ t("settingsModal.modelTab.modelHelperText") }}</p>
    </div>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-800" for="settings-model-effort">{{ t("settingsModal.modelTab.effortLabel") }}</label>
      <select
        id="settings-model-effort"
        v-model="effortDraft"
        class="w-full px-3 py-2 text-sm rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        data-testid="settings-model-effort-select"
        @change="save(effortField)"
      >
        <option value="">{{ t("settingsModal.modelTab.effortUnset") }}</option>
        <option v-for="level in EFFORT_LEVELS" :key="level" :value="level">{{ level }}</option>
      </select>
      <p class="text-xs text-gray-500">{{ t("settingsModal.modelTab.helperText") }}</p>
    </div>

    <div class="flex items-start gap-3 border-t border-gray-200 pt-3">
      <input
        id="settings-model-user-settings"
        v-model="userSettingsEnabled"
        type="checkbox"
        class="mt-1 h-4 w-4"
        :disabled="savingUserSettings || !loaded"
        data-testid="settings-model-user-settings-input"
        @change="saveUserSettings"
      />
      <label for="settings-model-user-settings" class="flex-1">
        <span class="block text-sm font-medium text-gray-800">{{ t("settingsModal.modelTab.userSettingsLabel") }}</span>
        <span class="block text-xs text-gray-500 mt-0.5">{{ t("settingsModal.modelTab.userSettingsHint") }}</span>
        <span v-if="skillListing" class="block text-xs text-gray-600 mt-1" data-testid="settings-model-skill-listing">
          {{ t("settingsModal.modelTab.skillListingSummary", { count: skillListing.skillCount }) }}
          <template v-if="skillListing.pluginNames.length > 0">
            {{ t("settingsModal.modelTab.skillListingPlugins", { plugins: skillListing.pluginNames.join(", ") }) }}
          </template>
        </span>
        <span v-if="skillListing?.heavy" class="block text-xs text-amber-700 mt-1" data-testid="settings-model-skill-listing-heavy">
          {{ t("settingsModal.modelTab.skillListingHeavy") }}
        </span>
      </label>
    </div>

    <div v-if="loaded && !errorMessage" class="flex items-center gap-3 text-xs">
      <span :class="colourOf(modelField)" data-testid="settings-model-model-status">
        {{ modelStatusText }}
      </span>
      <span :class="colourOf(effortField)" data-testid="settings-model-status">
        {{ statusText }}
      </span>
    </div>

    <p v-if="errorMessage" class="text-sm text-red-700" role="alert" data-testid="settings-model-error">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { CHAT_MODELS, EFFORT_LEVELS, type ChatModel, type EffortLevel } from "../config/models";
import { resolveSave, shouldStartSave } from "./settingsFieldSave";

const { t } = useI18n();

const props = defineProps<{
  reloadToken: number;
}>();

const emit = defineEmits<{
  saved: [];
}>();

interface SkillListing {
  skillCount: number;
  pluginNames: string[];
  heavy: boolean;
}

interface SettingsResponse {
  settings: { extraAllowedTools: string[]; effortLevel?: EffortLevel; chatModel?: ChatModel; loadClaudeUserSettings?: boolean };
  skillListing?: SkillListing | null;
}

// One select's whole state, so the save dance below is written once
// rather than per field. `""` is the "not set" option, which the PUT
// carries as the `null` clear-me sentinel.
interface SettingField<T extends string> {
  key: "effortLevel" | "chatModel";
  draft: Ref<T | "">;
  stored: Ref<T | "">;
  saving: Ref<boolean>;
}

const effortDraft = ref<EffortLevel | "">("");
const storedEffort = ref<EffortLevel | "">("");
const savingEffort = ref(false);
const effortField: SettingField<EffortLevel> = { key: "effortLevel", draft: effortDraft, stored: storedEffort, saving: savingEffort };

const modelDraft = ref<ChatModel | "">("");
const storedModel = ref<ChatModel | "">("");
const savingModel = ref(false);
const modelField: SettingField<ChatModel> = { key: "chatModel", draft: modelDraft, stored: storedModel, saving: savingModel };

// Default true matches `isClaudeUserSettingsEnabled` on the server.
const userSettingsEnabled = ref(true);
const storedUserSettings = ref(true);
const savingUserSettings = ref(false);
const skillListing = ref<SkillListing | null>(null);

const loaded = ref(false);
const errorMessage = ref("");

// statusText / colourOf are only consumed when there is no
// errorMessage (the template hides the strip in that case), so the
// error branches don't need to be repeated here.
const statusText = computed(() => {
  if (savingEffort.value) return t("common.saving");
  return storedEffort.value ? t("settingsModal.modelTab.configured", { level: storedEffort.value }) : t("settingsModal.modelTab.notConfigured");
});

const modelStatusText = computed(() => {
  if (savingModel.value) return t("common.saving");
  return storedModel.value ? t("settingsModal.modelTab.modelConfigured", { model: storedModel.value }) : t("settingsModal.modelTab.modelNotConfigured");
});

function colourOf<T extends string>(field: SettingField<T>): string {
  if (field.saving.value) return "text-gray-500";
  return field.stored.value ? "text-green-600" : "text-gray-500";
}

async function load(): Promise<void> {
  errorMessage.value = "";
  const response = await apiGet<SettingsResponse>(API_ROUTES.config.base);
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.modelTab.loadError");
    return;
  }
  storedEffort.value = response.data.settings.effortLevel ?? "";
  effortDraft.value = storedEffort.value;
  storedModel.value = response.data.settings.chatModel ?? "";
  modelDraft.value = storedModel.value;
  storedUserSettings.value = response.data.settings.loadClaudeUserSettings ?? true;
  userSettingsEnabled.value = storedUserSettings.value;
  skillListing.value = response.data.skillListing ?? null;
  loaded.value = true;
}

async function save<T extends string>(field: SettingField<T>): Promise<void> {
  if (!shouldStartSave(field.saving.value, field.draft.value, field.stored.value)) return;
  // Capture the submitted value before awaiting — if the user changes
  // the select again while this PUT is in flight, the second save()
  // would early-return on `saving=true`, and a naive
  // `stored = draft` assignment after await would store the newer
  // (unsaved) draft, masking later saves (codex review).
  const requested = field.draft.value;
  field.saving.value = true;
  errorMessage.value = "";
  // Empty selection clears the field. The server merges patches over
  // on-disk state, so omitting the key keeps the previous value — we
  // must send `null` to clear. Only this field travels, so the other
  // select's value is never echoed back and cannot be clobbered.
  const response = await apiPut<unknown>(API_ROUTES.config.settings, { [field.key]: requested === "" ? null : requested });
  field.saving.value = false;
  const message = response.ok ? "" : response.error || t("settingsModal.modelTab.saveError");
  const { store, resend } = resolveSave(response.ok, field.draft.value, requested);
  if (store) {
    field.stored.value = requested;
    emit("saved");
  }
  errorMessage.value = message;
  if (resend) {
    void save(field);
  }
}

async function saveUserSettings(): Promise<void> {
  if (savingUserSettings.value || userSettingsEnabled.value === storedUserSettings.value) return;
  const requested = userSettingsEnabled.value;
  savingUserSettings.value = true;
  errorMessage.value = "";
  const response = await apiPut<unknown>(API_ROUTES.config.settings, { loadClaudeUserSettings: requested });
  savingUserSettings.value = false;
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.modelTab.saveError");
    userSettingsEnabled.value = storedUserSettings.value;
    return;
  }
  storedUserSettings.value = requested;
  emit("saved");
}

watch(
  () => props.reloadToken,
  () => {
    void load();
  },
  { immediate: true },
);
</script>
