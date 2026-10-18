<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between">
      <span class="text-sm font-medium text-gray-700 truncate">
        {{ title ?? t.untitled }}
      </span>
      <span class="text-xs text-gray-500 shrink-0">
        {{ t.chartCount(charts.length) }}
      </span>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-for="(chart, idx) in charts" :key="idx" class="border border-gray-200 rounded-lg bg-white" :data-testid="`chart-card-${idx}`">
        <div class="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-medium text-gray-800 truncate">
              {{ chart.title ?? t.chartTitle(idx + 1) }}
            </span>
            <span v-if="chart.type" class="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-blue-50 text-blue-700 shrink-0">
              {{ chart.type }}
            </span>
          </div>
          <button
            class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-50 shrink-0"
            :data-testid="`chart-export-png-${idx}`"
            @click="exportPng(idx, chart.title)"
          >
            <span class="material-icons text-sm align-middle">download</span>
            {{ t.png }}
          </button>
        </div>
        <div v-if="chart.source" class="px-3 py-1 text-xs text-gray-500 border-b border-gray-100" :data-testid="`chart-source-${idx}`">
          {{ t.fromSpreadsheet(chart.source.range) }}
          <span v-if="sourceProblems[idx]" class="text-red-600" :data-testid="`chart-source-problem-${idx}`">{{ sourceProblems[idx] }}</span>
        </div>
        <div :ref="(el) => setChartRef(idx, el as HTMLDivElement | null)" class="w-full h-[400px]" :data-testid="`chart-canvas-${idx}`" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts";
import { PLUGIN_RUNTIME_KEY, type ToolResultComplete } from "gui-chat-protocol/vue";
import type { ChartEntry, ChartSource, ChartSourceRows, PresentChartData } from "../core/types";
import { chartOption, readSourceReply, settleWithin, sourceSpreadsheets } from "../core/source";
import { useT } from "../lang";

const t = useT();

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentChartData>;
}>();

const data = computed(() => props.selectedResult.data);
const charts = computed<ChartEntry[]>(() => data.value?.document?.charts ?? []);
const title = computed(() => data.value?.title ?? data.value?.document?.title);

// Optional: a host without a runtime still draws every inline chart, and says
// on a sourced one that it cannot follow the spreadsheet.
const runtime = inject(PLUGIN_RUNTIME_KEY, undefined);

// Index-aligned with `charts`, like `instances`.
const sourceRows = ref<(ChartSourceRows | undefined)[]>([]);
const sourceProblems = ref<(string | undefined)[]>([]);

const containers = ref<(HTMLDivElement | null)[]>([]);
// Kept as a plain array (not `ref`): ECharts instances are managed
// imperatively and should not trigger Vue re-renders on mutation.
// Index-aligned with `charts`; a skipped chart (missing container /
// malformed option) holds `undefined` so the array stays DENSE — a sparse
// array would make `for...of` yield `undefined` and crash resize/dispose.
const instances: (echarts.ECharts | undefined)[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setChartRef(idx: number, element: HTMLDivElement | null): void {
  containers.value[idx] = element;
}

// A card's width changes without the window's (the Canvas is expanded, a pane is
// dragged), and ECharts measures its container only on resize(). So each
// container is watched, not just the window. Absent where there is no layout.
const containerObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => handleResize());

function disposeAll(): void {
  containerObserver?.disconnect();
  for (const instance of instances) {
    instance?.dispose();
  }
  instances.length = 0;
}

// Force-disable mouse-wheel zoom on any dataZoom entry in the user's
// option. Rationale: in stack view the page needs to scroll past the
// chart, and `inside`-type dataZoom captures the wheel by default
// (zoomOnMouseWheel=true), which traps the scroll over the canvas.
// Toolbox/slider/drag zoom still work — only the wheel is disabled.
function disableWheelZoom(option: Record<string, unknown>): Record<string, unknown> {
  const { dataZoom } = option;
  if (dataZoom === undefined || dataZoom === null) return option;
  const normalise = (entry: unknown): unknown => {
    if (!isRecord(entry)) return entry;
    return {
      ...entry,
      zoomOnMouseWheel: false,
      moveOnMouseWheel: false,
    };
  };
  const next = Array.isArray(dataZoom) ? dataZoom.map(normalise) : normalise(dataZoom);
  return { ...option, dataZoom: next };
}

// renderAll is queued (queueMicrotask) and can run after the View is gone; a
// chart created then would stay alive and observed with nothing to dispose it.
const lifecycle = { unmounted: false };

function renderAll(): void {
  if (lifecycle.unmounted) return;
  disposeAll();
  for (let i = 0; i < charts.value.length; i += 1) {
    const element = containers.value[i];
    const chart = charts.value[i];
    if (!element || !chart) {
      // Keep the array dense: record the skipped slot so a later
      // container ref resolving doesn't leave a hole behind it.
      instances[i] = undefined;
      continue;
    }
    const instance = echarts.init(element);
    try {
      instance.setOption(disableWheelZoom(optionFor(chart, sourceRows.value[i])));
    } catch {
      // A malformed ECharts option for one chart shouldn't break the
      // others; skip it and leave its canvas blank.
    }
    instances[i] = instance;
    containerObserver?.observe(element);
  }
}

function handleResize(): void {
  for (const instance of instances) instance?.resize();
}

function optionFor(chart: ChartEntry, rows: ChartSourceRows | undefined): Record<string, unknown> {
  return chartOption(chart, rows, runtime !== undefined);
}

// Long enough for a large workbook on a busy host; a read past it is reported
// as a problem instead of leaving the chart silently blank.
const SOURCE_READ_TIMEOUT_MS = 30_000;

function readSource(source: ChartSource): Promise<ChartSourceRows> {
  if (!runtime) return Promise.reject(new Error(t.value.notLinked));
  const read = runtime.dispatch({ kind: "readSource", source }, (raw) => {
    const rows = readSourceReply(raw);
    if (!rows) throw new Error(t.value.unreadableSource);
    return rows;
  });
  return settleWithin(read, SOURCE_READ_TIMEOUT_MS, t.value.sourceTimedOut);
}

// A newer load supersedes an older one still in flight, so a slow reply for an
// earlier version of the sheet cannot overwrite the latest.
let loadGeneration = 0;

async function loadSources(): Promise<void> {
  const generation = ++loadGeneration;
  const results = await Promise.allSettled(charts.value.map((chart) => (chart.source ? readSource(chart.source) : Promise.resolve(undefined))));
  if (generation !== loadGeneration) return;
  sourceRows.value = results.map((result) => (result.status === "fulfilled" ? result.value : undefined));
  sourceProblems.value = results.map((result) =>
    result.status === "rejected" ? String(result.reason instanceof Error ? result.reason.message : result.reason) : undefined,
  );
  renderAll();
}

// The host announces a change to a watched file on `file:<path>`; each
// workbook this document reads is watched while the View is open.
let unsubscribers: (() => void)[] = [];

function unsubscribeAll(): void {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function followSources(): void {
  unsubscribeAll();
  if (!runtime) return;
  unsubscribers = sourceSpreadsheets(charts.value.map((chart) => chart.source)).map((path) =>
    runtime.pubsub.subscribe(`file:${path}`, () => void loadSources()),
  );
}

function showDocument(): void {
  // Any read still in flight belongs to the document being replaced, even when
  // the new one has no source and starts no read of its own.
  loadGeneration += 1;
  sourceRows.value = [];
  sourceProblems.value = [];
  followSources();
  // Wait a tick so the refs are populated before we render.
  queueMicrotask(renderAll);
  if (charts.value.some((chart) => chart.source)) void loadSources();
}

onMounted(() => {
  showDocument();
  window.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  lifecycle.unmounted = true;
  window.removeEventListener("resize", handleResize);
  unsubscribeAll();
  loadGeneration += 1;
  disposeAll();
});

// Re-render when the selected result switches to a different document (another
// chart result in the sidebar), or the host updates this one in place — new
// options to draw, or other sources whose rows and subscriptions must replace the old.
watch(
  () => [data.value?.filePath, JSON.stringify(data.value?.document ?? null)],
  () => showDocument(),
);

function exportPng(idx: number, chartTitle?: string): void {
  const instance = instances[idx];
  if (!instance) return;
  const dataUrl = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: "#ffffff",
  });
  let filenameSlug = (chartTitle ?? title.value ?? "chart").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  while (filenameSlug.startsWith("-")) filenameSlug = filenameSlug.slice(1);
  while (filenameSlug.endsWith("-")) filenameSlug = filenameSlug.slice(0, -1);
  if (!filenameSlug) filenameSlug = "chart";
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `${filenameSlug}-${idx + 1}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
</script>
