<template>
  <div class="space-y-3" data-testid="settings-gemini-tab">
    <div v-if="!geminiAvailable" class="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800" data-testid="settings-gemini-warning">
      <span class="material-icons text-sm align-middle mr-1">warning</span>
      <i18n-t keypath="settingsModal.geminiTab.required" tag="span">
        <template #envKey><code class="font-mono">GEMINI_API_KEY</code></template>
      </i18n-t>
    </div>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-800" for="settings-gemini-api-key">{{ t("settingsModal.geminiTab.apiKeyLabel") }}</label>
      <div class="flex items-center gap-2">
        <input
          id="settings-gemini-api-key"
          v-model="apiKeyDraft"
          type="password"
          autocomplete="off"
          spellcheck="false"
          class="flex-1 px-3 py-2 text-sm font-mono rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          :placeholder="t('settingsModal.geminiTab.apiKeyPlaceholder')"
          :disabled="busy"
          data-testid="settings-gemini-api-key-input"
          @keydown.enter.prevent="save"
        />
        <button
          class="px-3 py-2 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          :disabled="busy || apiKeyDraft.trim() === ''"
          data-testid="settings-gemini-save-btn"
          @click="save"
        >
          {{ t("common.save") }}
        </button>
      </div>
      <p class="text-xs text-gray-500">
        <i18n-t keypath="settingsModal.geminiTab.helperText" tag="span">
          <template #studioLink>
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- "Google AI Studio" is a product name, not translatable copy -->
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">Google AI Studio</a>
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
          </template>
        </i18n-t>
      </p>
      <p class="text-xs text-gray-500">{{ t("settingsModal.geminiTab.storageNote") }}</p>
    </div>

    <div class="flex items-center gap-3 text-xs">
      <span :class="statusColour" data-testid="settings-gemini-status">{{ statusText }}</span>
      <button
        v-if="source === 'gui'"
        class="text-xs text-red-600 hover:underline disabled:text-gray-400"
        :disabled="busy"
        data-testid="settings-gemini-clear-btn"
        @click="clear"
      >
        {{ t("settingsModal.geminiTab.clear") }}
      </button>
    </div>

    <!-- Only when the shell is the one supplying the key: that value comes
         from an environment this UI cannot edit, so saying where it came
         from is the difference between "nothing to do" and a hunt. -->
    <p v-if="source === 'env'" class="text-xs text-gray-500" data-testid="settings-gemini-env-source">
      <i18n-t keypath="settingsModal.geminiTab.fromEnvironment" tag="span">
        <template #envFile
          ><code class="font-mono">{{ envFileLabel }}</code></template
        >
      </i18n-t>
    </p>

    <p v-if="errorMessage" class="text-sm text-red-700" role="alert" data-testid="settings-gemini-error">{{ errorMessage }}</p>

    <button class="px-3 py-1.5 text-sm rounded bg-gray-100 text-gray-800 hover:bg-gray-200" data-testid="settings-gemini-ask-btn" @click="emit('ask')">
      {{ t("settingsModal.geminiAskButton") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiDelete, apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

const props = defineProps<{
  /** Bumped by the parent each time the modal opens, so a key stored from
   *  another window (or a file written by hand) shows up. */
  reloadToken: number;
  /** Whether the server currently has a key at all — drives the warning
   *  strip, and comes from `/api/health` rather than this tab's own load. */
  geminiAvailable: boolean;
  /** The `.env` this launch reads, for the "it came from the environment"
   *  line. Absolute, because which directory it is differs per launch route. */
  envFilePath: string;
}>();

const emit = defineEmits<{
  /** The key changed, so the parent can re-read `/api/health`. */
  saved: [];
  /** Ask Claude about the key (the pre-existing button). */
  ask: [];
}>();

const GEMINI_KEY = "GEMINI_API_KEY";
const ENV_FILE_NAME = ".env";

interface SecretStatus {
  key: string;
  configured: boolean;
  source: "gui" | "env" | "none";
}

interface SecretsResponse {
  secrets: SecretStatus[];
}

const apiKeyDraft = ref("");
const source = ref<SecretStatus["source"]>("none");
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");

const busy = computed(() => loading.value || saving.value);
const envFileLabel = computed(() => props.envFilePath || ENV_FILE_NAME);

const statusText = computed(() => {
  if (saving.value) return t("common.saving");
  if (loading.value) return t("common.loading");
  if (source.value === "gui") return t("settingsModal.geminiTab.storedHere");
  if (source.value === "env") return t("settingsModal.geminiTab.storedInEnvironment");
  return t("settingsModal.geminiTab.notConfigured");
});

const statusColour = computed(() => {
  if (errorMessage.value) return "text-red-600";
  return source.value === "none" ? "text-gray-500" : "text-green-600";
});

async function load(): Promise<void> {
  errorMessage.value = "";
  loading.value = true;
  const response = await apiGet<SecretsResponse>(API_ROUTES.secrets);
  loading.value = false;
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.geminiTab.loadError");
    return;
  }
  // The value itself is never returned, so the field starts empty even when
  // a key is stored — the status line is what says one exists.
  source.value = response.data.secrets.find((entry) => entry.key === GEMINI_KEY)?.source ?? "none";
  apiKeyDraft.value = "";
}

async function save(): Promise<void> {
  const value = apiKeyDraft.value.trim();
  if (busy.value || value === "") return;
  saving.value = true;
  errorMessage.value = "";
  const response = await apiPut<SecretsResponse>(API_ROUTES.secrets, { key: GEMINI_KEY, value });
  saving.value = false;
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.geminiTab.saveError");
    return;
  }
  source.value = response.data.secrets.find((entry) => entry.key === GEMINI_KEY)?.source ?? "gui";
  apiKeyDraft.value = "";
  emit("saved");
}

async function clear(): Promise<void> {
  if (busy.value) return;
  saving.value = true;
  errorMessage.value = "";
  const response = await apiDelete<SecretsResponse>(API_ROUTES.secrets, { key: GEMINI_KEY });
  saving.value = false;
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.geminiTab.clearError");
    return;
  }
  source.value = response.data.secrets.find((entry) => entry.key === GEMINI_KEY)?.source ?? "none";
  emit("saved");
}

watch(() => props.reloadToken, load, { immediate: true });
</script>
