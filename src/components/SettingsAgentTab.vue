<template>
  <div class="space-y-3" data-testid="settings-agent-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.agentTab.description") }}</p>
    <label class="block text-sm font-medium text-gray-800" for="settings-agent-backend">
      {{ t("settingsModal.agentTab.backendLabel") }}
    </label>
    <select
      id="settings-agent-backend"
      v-model="draft"
      class="w-full px-3 py-2 text-sm rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      data-testid="settings-agent-backend-select"
      @change="save"
    >
      <option v-for="backend in BACKENDS" :key="backend" :value="backend">
        {{ t(`settingsModal.agentTab.backend.${backend}`) }}
      </option>
    </select>
    <p class="text-xs text-gray-500">{{ t("settingsModal.agentTab.helperText") }}</p>
    <p v-if="saving" class="text-xs text-gray-500">{{ t("common.saving") }}</p>
    <p v-else-if="loaded && !errorMessage" class="text-xs text-green-600" data-testid="settings-agent-status">
      {{ t("settingsModal.agentTab.configured", { backend: t(`settingsModal.agentTab.backend.${stored}`) }) }}
    </p>
    <p v-if="errorMessage" class="text-sm text-red-700" role="alert">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPut } from "../utils/api";

const BACKENDS = ["auto", "claude-code", "codex"] as const;
type AgentBackend = (typeof BACKENDS)[number];
interface SettingsResponse {
  settings: { agentBackend?: AgentBackend };
}

const props = defineProps<{ reloadToken: number }>();
const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const draft = ref<AgentBackend>("codex");
const stored = ref<AgentBackend>("codex");
const loaded = ref(false);
const saving = ref(false);
const errorMessage = ref("");

async function load(): Promise<void> {
  errorMessage.value = "";
  const response = await apiGet<SettingsResponse>(API_ROUTES.config.base);
  if (!response.ok) {
    setError(response.error, "loadError");
    return;
  }
  stored.value = response.data.settings.agentBackend ?? "codex";
  draft.value = stored.value;
  loaded.value = true;
}

async function save(): Promise<void> {
  if (saving.value || draft.value === stored.value) return;
  const requested = draft.value;
  saving.value = true;
  errorMessage.value = "";
  const response = await apiPut<unknown>(API_ROUTES.config.settings, { agentBackend: requested });
  saving.value = false;
  if (!response.ok) {
    setError(response.error, "saveError");
    return;
  }
  stored.value = requested;
  emit("saved");
  if (draft.value !== requested) void save();
}

function setError(message: string | undefined, fallbackKey: "loadError" | "saveError"): void {
  errorMessage.value = message || t(`settingsModal.agentTab.${fallbackKey}`);
}

watch(
  () => props.reloadToken,
  () => void load(),
  { immediate: true },
);
</script>
