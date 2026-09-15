<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <div>
        <h2 class="text-lg font-semibold text-gray-800">{{ t("pluginManageSkills.heading") }}</h2>
        <p class="text-xs text-gray-400 mt-0.5">{{ t("pluginManageSkills.subheading", { count: skills.length }) }}</p>
        <i18n-t keypath="pluginManageSkills.sectionLegendActive" tag="p" class="text-xs text-gray-400 mt-0.5">
          <template #system>
            <span class="material-icons !text-sm align-middle leading-none text-gray-500" aria-hidden="true">lock</span>
          </template>
          <template #project>
            <span class="material-icons !text-sm align-middle leading-none text-green-600" aria-hidden="true">folder</span>
          </template>
          <template #user>
            <span class="material-icons !text-sm align-middle leading-none text-blue-500" aria-hidden="true">home</span>
          </template>
        </i18n-t>
        <i18n-t keypath="pluginManageSkills.sectionLegendCatalog" tag="p" class="text-xs text-gray-400 mt-0.5">
          <template #star>
            <span class="material-icons !text-sm align-middle leading-none text-amber-500" aria-hidden="true">star</span>
          </template>
        </i18n-t>
      </div>
    </div>

    <!-- List load error (standalone mode) -->
    <div v-if="listError" class="px-6 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">
      {{ listError }}
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Left: two collapsible sections — Active (discovered by
           Claude Code, loaded into the prompt) and Catalog (browse /
           ★ star / ▶ run once without bloating the prompt). Aligns
           with the #1335 catalog/active model. -->
      <div class="w-64 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50">
        <SkillActiveList
          :skills="activeSkills"
          :open="isSectionOpen('active')"
          :selected-name="selectedName"
          :catalog-selected="selectedCatalog !== null"
          @toggle="toggleSection('active')"
          @select="selectActiveSkill"
        />
        <SkillCatalogList
          :open="isSectionOpen('catalog')"
          :presets="catalogPresets"
          :external-count="catalogExternal.length"
          :external-groups="externalGroups"
          :repo-collapsed="repoCollapsed"
          :selected-catalog-key="selectedCatalogKey"
          :catalog-error="catalogError"
          :repo-list-error="repoListError"
          :preset-source-meta="presetSourceMeta"
          :updating-repo-id="updatingRepoId"
          :uninstalling-repo-id="uninstallingRepoId"
          @toggle="toggleSection('catalog')"
          @select-entry="selectCatalogEntry"
          @toggle-repo="toggleRepo"
          @update-repo="updateRepo"
          @uninstall-repo="uninstallRepo"
          @add-repo="openAddRepo"
        />
      </div>

      <!-- Right: detail pane -->
      <div class="flex-1 min-w-0 overflow-y-auto">
        <CatalogDetailPane
          v-if="selectedCatalog"
          :entry="selectedCatalog"
          :source-meta="presetSourceMeta"
          :actioning-key="catalogActioningKey"
          :loading="catalogDetailLoading"
          :error="catalogError"
          :detail="catalogDetail"
          @star="starCatalogEntry"
        />

        <div v-else-if="!selected" class="p-6 text-sm text-gray-400 italic">{{ t("pluginManageSkills.selectHint") }}</div>
        <SkillDetailPane
          v-else
          v-model:edit-description="editDescription"
          v-model:edit-body="editBody"
          :selected="selected"
          :detail="detail"
          :editing="editing"
          :saving="saving"
          :deleting="deleting"
          :detail-loading="detailLoading"
          :detail-error="detailError"
          :is-selected-editable="isSelectedEditable"
          :is-selected-preset="isSelectedPreset"
          @edit="startEdit"
          @cancel="cancelEdit"
          @save="saveEdit"
          @delete="deleteSkill"
        />
      </div>
    </div>

    <AddRepoModal
      v-if="addRepoOpen"
      v-model:url="addRepoUrl"
      v-model:subpath="addRepoSubpath"
      :error="addRepoError"
      :busy="addRepoBusy"
      :suggestions="suggestions"
      :selected-suggestion-url="selectedSuggestionUrl"
      @close="addRepoOpen = false"
      @install="installRepo(addRepoUrl, addRepoSubpath)"
      @select-suggestion="selectSuggestion"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData, SkillSummary, SkillDetail } from "./index";
import { apiGet, apiPut, apiDelete } from "../../utils/api";
import { pluginEndpoints } from "../api";
import { buildRouteUrl } from "../meta-types";
import type { SkillsEndpoints } from "./definition";
import {
  compareSkillsForSidebar,
  loadCollapsedSections,
  persistCollapsedSections,
  pickInitialSelection,
  nextSelectionAfterDelete,
  toggleInSet,
  PRESET_SOURCE_META,
  type SkillSectionKey,
  type SourceMeta,
} from "./categories";
import { isPresetActivation } from "./presetDetection";
import { updateSkillDescription, removeSkillByName } from "./skillListEdits";
import { useSkillCatalog } from "./useSkillCatalog";
import { useExternalRepos } from "./useExternalRepos";
import AddRepoModal from "./AddRepoModal.vue";
import CatalogDetailPane from "./CatalogDetailPane.vue";
import SkillActiveList from "./SkillActiveList.vue";
import SkillCatalogList from "./SkillCatalogList.vue";
import SkillDetailPane from "./SkillDetailPane.vue";

const { t } = useI18n();

const props = defineProps<{
  selectedResult?: ToolResultComplete<ManageSkillsData>;
}>();

// Local copy of the skill list so the Delete button can remove rows
// without waiting for a fresh tool_result push. Shallow-copied (not the
// prop array by reference) so local edits never rewrite the shared
// tool result the Preview / chat export also read. Re-seeded whenever
// the underlying tool result changes.
const skills = ref<SkillSummary[]>([...(props.selectedResult?.data?.skills ?? [])]);

// Collapsed-section state for the sidebar (active / catalog). Persisted
// to localStorage so each user's preference survives reloads.
// shallowRef because we always replace the Set wholesale (toggleSection
// builds a fresh Set), avoiding the deep-proxy that ref() would create.
const collapsedSections = shallowRef<Set<SkillSectionKey>>(loadCollapsedSections());

// Active skills, alphabetised. Provenance (system / project / user) is
// shown as a per-row badge via sourceMeta, not as its own collapsible
// group — the sidebar groups by section, not by provenance.
const activeSkills = computed(() => [...skills.value].sort(compareSkillsForSidebar));

function isSectionOpen(key: SkillSectionKey): boolean {
  return !collapsedSections.value.has(key);
}

function toggleSection(key: SkillSectionKey): void {
  const next = toggleInSet(collapsedSections.value, key);
  collapsedSections.value = next;
  persistCollapsedSections(next);
}

const selectedName = ref<string | null>(pickInitialSelection(activeSkills.value, collapsedSections.value));
const detail = ref<SkillDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const deleting = ref(false);
const editing = ref(false);
const saving = ref(false);
const editDescription = ref("");
const editBody = ref("");

const selected = computed(() => skills.value.find((skill) => skill.name === selectedName.value) ?? null);

// Edit/Delete follows the backend writer contract (writer.ts rejects
// only source === "user"), NOT the mc- name heuristic. Under #1335
// PR-A the launcher syncs presets to data/skills/catalog/preset/ and
// leaves .claude/skills/ untouched, so a ★-starred mc- preset is a
// normal project-scope skill — gating it read-only by name would make
// activation one-way (no un-star / edit from /skills). The mc- =
// "system" classification survives only as the provenance badge.
const isSelectedEditable = computed(() => detail.value?.source === "project");

const listError = ref<string | null>(null);

const endpoints = pluginEndpoints<SkillsEndpoints>("skills");

async function refreshActiveList(): Promise<void> {
  // Mirrors the onMounted fetch so the left-column list reflects a
  // newly-starred skill without waiting for the next manageSkills tool
  // result. Errors here are non-fatal — the catalog state is the source
  // of truth for the "Starred" badge.
  const response = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
  if (response.ok && Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
  }
}

// Active and catalog selections are mutually exclusive — selecting a
// catalog row clears the active selection (and vice versa) so the right
// pane has a single source of truth.
function clearActiveSelection(): void {
  selectedName.value = null;
}

// Preset-catalog cluster (#1335 PR-B): browse / select / ★ Star / preview.
const catalog = useSkillCatalog({ refreshActiveList, clearActiveSelection });
const {
  catalogPresets,
  catalogExternal,
  catalogError,
  selectedCatalog,
  catalogDetail,
  catalogDetailLoading,
  catalogActioningKey,
  selectedCatalogKey,
  loadCatalog,
  selectCatalogEntry,
  starCatalogEntry,
} = catalog;

// True when the selected active skill has a matching entry in the preset
// catalog — meaning a "delete" from `.claude/skills/<slug>/` is
// recoverable (the launcher re-syncs the catalog copy on every boot). We
// expose this case as "Unstar" with a non-destructive confirm; the DELETE
// endpoint is identical. Catalog membership (not the `mc-` slug prefix) is
// the authoritative signal — see isPresetActivation tests.
const isSelectedPreset = computed(() => isPresetActivation(detail.value?.name, catalogPresets.value));

// External-repo cluster (#1383 PR-C2): installed repos + add-repo modal.
const repos = useExternalRepos({
  catalogExternal,
  catalogError,
  reloadCatalog: loadCatalog,
  refreshActiveList,
  clearCatalogSelectionForRepo: catalog.clearSelectionIfRepo,
});
const {
  externalGroups,
  repoCollapsed,
  repoListError,
  toggleRepo,
  addRepoOpen,
  addRepoUrl,
  addRepoSubpath,
  addRepoError,
  addRepoBusy,
  suggestions,
  selectedSuggestionUrl,
  uninstallingRepoId,
  updatingRepoId,
  loadExternalRepos,
  openAddRepo,
  selectSuggestion,
  installRepo,
  uninstallRepo,
  updateRepo,
} = repos;

// Catalog preset rows share one provenance badge (the launcher-managed
// "library" glyph). Thin view wrapper: the pure PRESET_SOURCE_META
// carries an i18n title KEY; resolve it here through the live t() so the
// child keeps its { icon, title, colour } contract.
const presetSourceMeta = computed<SourceMeta>(() => ({
  icon: PRESET_SOURCE_META.icon,
  colour: PRESET_SOURCE_META.colour,
  title: t(PRESET_SOURCE_META.titleKey),
}));

function selectActiveSkill(name: string): void {
  catalog.clearSelection();
  selectedName.value = name;
}

// Reset the selection when the tool result is replaced (e.g. the user
// opens a newer `manageSkills` invocation from the sidebar).
watch(
  () => props.selectedResult?.uuid,
  () => {
    skills.value = [...(props.selectedResult?.data?.skills ?? [])];
    selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
    catalog.reset();
    repos.resetModalState();
  },
);

// Standalone mode: if no selectedResult was passed, fetch the skill
// list from the API on mount so the view is populated.
onMounted(async () => {
  // Always load the catalog so the section appears even when the
  // view was opened from a tool result (which only carries the
  // active list). External repos load in parallel — failure of one
  // doesn't block the other (each sets its own inline error).
  await Promise.all([loadCatalog(), loadExternalRepos()]);
  if (props.selectedResult || skills.value.length > 0) return;
  const response = await apiGet<{ skills: SkillSummary[] }>(endpoints.list.url);
  if (!response.ok) {
    listError.value = t("pluginManageSkills.errListFailed", { error: response.error });
    return;
  }
  if (Array.isArray(response.data.skills)) {
    skills.value = response.data.skills;
    selectedName.value = pickInitialSelection(activeSkills.value, collapsedSections.value);
  }
});

// Fetch detail when the selection changes. Failures surface inline
// so the Run button stays disabled and the user sees why. Each request
// captures the `name` it was issued for — if the user clicks another
// skill while the first fetch is in flight, the slower response is
// discarded (otherwise stale detail can land under the new selection
// and break deleteSkill(), which reads `detail.value.name`).
watch(
  selectedName,
  async (name) => {
    if (!name) {
      detail.value = null;
      editing.value = false;
      return;
    }
    editing.value = false;
    detailLoading.value = true;
    detailError.value = null;
    const response = await apiGet<{ skill: SkillDetail }>(buildRouteUrl(endpoints.detail, { name }));
    if (selectedName.value !== name) {
      // Selection changed while this request was in flight — drop it.
      return;
    }
    if (!response.ok) {
      detailError.value = t("pluginManageSkills.errDetailFailed", { error: response.error });
      detail.value = null;
    } else {
      detail.value = response.data.skill;
    }
    detailLoading.value = false;
  },
  { immediate: true },
);

function startEdit(): void {
  if (!detail.value) return;
  editDescription.value = detail.value.description;
  editBody.value = detail.value.body;
  editing.value = true;
}

function cancelEdit(): void {
  editing.value = false;
}

async function saveEdit(): Promise<void> {
  if (!detail.value) return;
  const { name } = detail.value;
  saving.value = true;
  detailError.value = null;
  const result = await apiPut<{ updated: boolean; path: string }>(buildRouteUrl(endpoints.update, { name }), {
    description: editDescription.value,
    body: editBody.value,
  });
  saving.value = false;
  if (!result.ok) {
    detailError.value = t("pluginManageSkills.errSaveFailed", { error: result.error });
    return;
  }
  // The sidebar summary keys off the captured `name`, so it stays correct
  // even if the selection changed mid-save.
  skills.value = updateSkillDescription(skills.value, name, editDescription.value);
  // But `detail.value` may now describe a different skill (the user clicked
  // away while the PUT was in flight) — only patch it when it is still ours,
  // or we would graft skill A's edits onto skill B's pane.
  if (detail.value?.name === name) {
    detail.value = {
      ...detail.value,
      description: editDescription.value,
      body: editBody.value,
    };
    editing.value = false;
  }
}

// Delete is project-scope only — see saveProjectSkill / deleteProjectSkill
// in server/skills/writer.ts. The button is hidden in the template
// when source !== "project". A native confirm() is enough for phase 1
// since the action is reversible by re-saving via the conversation.
// For preset (mc-*) entries the same endpoint is invoked, but the
// confirm copy reflects that the catalog copy survives — see
// `isSelectedPreset` above and `syncPresetSkills` in skills-preset.ts.
async function deleteSkill(): Promise<void> {
  if (!detail.value || detail.value.source !== "project") return;
  const { name } = detail.value;
  const confirmKey = isSelectedPreset.value ? "pluginManageSkills.confirmUnstar" : "pluginManageSkills.confirmDelete";
  if (!window.confirm(t(confirmKey, { name }))) {
    return;
  }
  deleting.value = true;
  const result = await apiDelete<unknown>(buildRouteUrl(endpoints.remove, { name }));
  deleting.value = false;
  if (!result.ok) {
    detailError.value = result.error || t("pluginManageSkills.errDeleteFailed");
    return;
  }
  // Remove from the local list, then advance the selection to the deleted
  // row's neighbour (NOT the first row). Only advance when the deleted skill
  // is STILL the selected one — the DELETE may have been slow and the user
  // may have clicked another skill meanwhile, whose detail fetch is already
  // in flight and must not be clobbered. `previousActive` is captured before
  // the removal so the deleted row's index still locates its neighbour.
  const previousActive = activeSkills.value;
  const wasSelected = selectedName.value === name;
  skills.value = removeSkillByName(skills.value, name);
  selectedName.value = nextSelectionAfterDelete(previousActive, name, selectedName.value, collapsedSections.value);
  // The selectedName watch reloads detail on change; only null it here when
  // the selection didn't move (deleted skill was NOT selected leaves detail
  // alone; deleted-and-was-selected with no successor nulls via the watch).
  if (wasSelected && selectedName.value === null) detail.value = null;
  // Refresh the catalog so a deleted star reverts to ☆ Star.
  // `alreadyActive` is computed from disk at list time — without
  // this call the badge + right-pane state would lag until the
  // next mount. (#1335 PR-B2 follow-up.)
  await loadCatalog();
  catalog.reconcileAfterDelete(name);
}
</script>
