<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div :class="['px-4 py-2 border-b shrink-0 flex items-center justify-between', palette.divider]">
      <span :class="['text-sm font-medium truncate', palette.title]">
        {{ title ?? t.untitled }}
      </span>
      <span :class="['text-xs shrink-0', palette.muted]">
        {{ t.chartCount(charts.length) }}
      </span>
    </div>
    <div :class="['flex-1 overflow-y-auto p-4 grid gap-4 content-start items-start', gridColumnsClass(columns)]" data-testid="chart-grid">
      <div v-for="(chart, idx) in charts" :key="idx" :class="['border rounded-lg min-w-0', palette.card]" :data-testid="`chart-card-${idx}`">
        <div :class="['px-3 py-2 border-b flex items-center justify-between gap-2', palette.divider]">
          <div class="flex items-center gap-2 min-w-0">
            <span :class="['text-sm font-medium truncate', palette.title]">
              {{ chart.title ?? t.chartTitle(idx + 1) }}
            </span>
            <span v-if="chart.type" :class="['text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0', palette.badge]">
              {{ chart.type }}
            </span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button :class="[EXPORT_BUTTON_CLASS, palette.button]" :data-testid="`chart-export-png-${idx}`" @click="exportPng(idx, chart.title)">
              {{ t.png }}
            </button>
            <button
              v-if="svgExportable(chart)"
              :class="[EXPORT_BUTTON_CLASS, palette.button]"
              :data-testid="`chart-export-svg-${idx}`"
              @click="exportSvg(idx, chart.title)"
            >
              {{ t.svg }}
            </button>
            <button
              v-if="csvReady[idx]"
              :class="[EXPORT_BUTTON_CLASS, palette.button]"
              :data-testid="`chart-export-csv-${idx}`"
              @click="exportCsv(idx, chart.title)"
            >
              {{ t.csv }}
            </button>
          </div>
        </div>
        <div v-if="chartSources(chart).length > 0" :class="['px-3 py-1 text-xs border-b', palette.muted, palette.divider]" :data-testid="`chart-source-${idx}`">
          {{
            t.fromSpreadsheet(
              chartSources(chart)
                .map((source) => source.range)
                .join(", "),
            )
          }}
          <span v-if="sourceProblems[idx]" class="text-red-600" :data-testid="`chart-source-problem-${idx}`">{{ sourceProblems[idx] }}</span>
        </div>
        <div v-if="drawProblems[idx]" :class="['px-3 py-1 text-xs text-red-600 border-b', palette.divider]" :data-testid="`chart-draw-problem-${idx}`">
          {{ t.cannotDraw(drawProblems[idx] ?? "") }}
        </div>
        <div
          :ref="(el) => setChartRef(idx, el as HTMLDivElement | null)"
          class="w-full h-[var(--chart-height)]"
          :style="{ '--chart-height': `${chartHeightPx(chart)}px` }"
          :data-testid="`chart-canvas-${idx}`"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { echarts } from "../core/charting";
import { PLUGIN_RUNTIME_KEY, type ToolResultComplete } from "gui-chat-protocol/vue";
import type { ChartEntry, ChartSource, ChartSourceRows, PresentChartData } from "../core/types";
import { setOptionProblem } from "../core/drawProblem";
import { withFormatters } from "../core/formats";
import { chartHeightPx, documentColumns, gridColumnsClass } from "../core/layout";
import { chartOption, chartSources, readSourceReply, settleWithin, sourceSpreadsheets } from "../core/source";
import { useT } from "../lang";
import { chartCsvRows, fileSlug, toCsv } from "../core/exportData";
import { CARD_CLASSES, EXPORT_BACKGROUND, useHostAppearance } from "./appearance";
import { loadBrowserExtensions, neededExtensions, needsBrowser } from "../core/extensions";

const t = useT();

const props = defineProps<{
  selectedResult: ToolResultComplete<PresentChartData>;
}>();

const data = computed(() => props.selectedResult.data);
const charts = computed<ChartEntry[]>(() => data.value?.document?.charts ?? []);
const title = computed(() => data.value?.title ?? data.value?.document?.title);
const columns = computed(() => documentColumns(data.value?.document));

const appearance = useHostAppearance();
const palette = computed(() => CARD_CLASSES[appearance.value]);
const EXPORT_BUTTON_CLASS = "px-2 py-1 text-xs rounded border";

// Optional: a host without a runtime still draws every inline chart, and says
// on a sourced one that it cannot follow the spreadsheet.
const runtime = inject(PLUGIN_RUNTIME_KEY, undefined);

// Index-aligned with `charts`, like `instances`.
// Each chart's ranges, in the order of its sources.
const sourceRows = ref<(ChartSourceRows[] | undefined)[]>([]);
const sourceProblems = ref<(string | undefined)[]>([]);
// Why ECharts could not draw a chart, so its card says so instead of staying blank.
const drawProblems = ref<(string | null)[]>([]);
// Whether a chart's data has a table shape, so its CSV button is shown.
const csvReady = ref<boolean[]>([]);
// The option each chart was last drawn with, for the SVG and CSV exports. Plain, like `instances`.
const drawnOptions: (Record<string, unknown> | undefined)[] = [];

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

// renderAll is queued (after the extensions load) and can run after the View is gone; a
// chart created then would stay alive and observed with nothing to dispose it.
const lifecycle = { unmounted: false };

function renderAll(): void {
  if (lifecycle.unmounted) return;
  disposeAll();
  const problems: (string | null)[] = [];
  for (let i = 0; i < charts.value.length; i += 1) {
    const element = containers.value[i];
    const chart = charts.value[i];
    if (!element || !chart) {
      // Keep the array dense: record the skipped slot so a later
      // container ref resolving doesn't leave a hole behind it.
      instances[i] = undefined;
      problems[i] = null;
      continue;
    }
    const instance = echarts.init(element, echartsTheme());
    // A malformed option for one chart doesn't stop the others.
    const problem = drawProblem(instance, chart, sourceRows.value[i], i);
    // Until its rows arrive a sourced chart is drawn empty, which a transform cannot read; the
    // source line already says when they will not come.
    problems[i] = awaitingRows(chart, sourceRows.value[i]) ? null : problem;
    instances[i] = instance;
    containerObserver?.observe(element);
  }
  drawProblems.value = problems;
  csvReady.value = charts.value.map((_, index) => {
    const option = drawnOptions[index];
    return option !== undefined && chartCsvRows(option) !== null;
  });
}

const echartsTheme = (): string | undefined => (appearance.value === "dark" ? "dark" : undefined);

/** ECharts' dark theme paints its own background; the card's shows through instead, unless the option sets one. */
const themed = (option: Record<string, unknown>): Record<string, unknown> =>
  appearance.value === "dark" ? { backgroundColor: "transparent", ...option } : option;

function handleResize(): void {
  for (const instance of instances) instance?.resize();
}

function awaitingRows(chart: ChartEntry, rows: ChartSourceRows[] | undefined): boolean {
  return chartSources(chart).length > 0 && runtime !== undefined && rows === undefined;
}

// Reshaping a source (groupBy) throws when its column is missing; that is this chart's problem.
function drawProblem(instance: echarts.ECharts, chart: ChartEntry, rows: ChartSourceRows[] | undefined, index: number): string | null {
  drawnOptions[index] = undefined;
  try {
    const option = themed(disableWheelZoom(optionFor(chart, rows)));
    drawnOptions[index] = option;
    return setOptionProblem(instance, option);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function optionFor(chart: ChartEntry, rows: ChartSourceRows[] | undefined): Record<string, unknown> {
  return withFormatters(chartOption(chart, rows, runtime !== undefined), runtime?.locale.value);
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

function readChartRanges(ranges: ChartSource[]): Promise<ChartSourceRows[] | undefined> {
  return ranges.length === 0 ? Promise.resolve(undefined) : Promise.all(ranges.map(readSource));
}

// A newer load supersedes an older one still in flight, so a slow reply for an
// earlier version of the sheet cannot overwrite the latest.
let loadGeneration = 0;

async function loadSources(): Promise<void> {
  const generation = ++loadGeneration;
  const results = await Promise.allSettled(charts.value.map((chart) => readChartRanges(chartSources(chart))));
  if (generation !== loadGeneration) return;
  sourceRows.value = results.map((result) => (result.status === "fulfilled" ? result.value : undefined));
  sourceProblems.value = results.map((result) =>
    result.status === "rejected" ? String(result.reason instanceof Error ? result.reason.message : result.reason) : undefined,
  );
  await extensions.ready;
  if (generation !== loadGeneration) return;
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
  unsubscribers = sourceSpreadsheets(charts.value.flatMap(chartSources)).map((path) => runtime.pubsub.subscribe(`file:${path}`, () => void loadSources()));
}

function showDocument(): void {
  // Any read still in flight belongs to the document being replaced, even when
  // the new one has no source and starts no read of its own.
  loadGeneration += 1;
  sourceRows.value = [];
  sourceProblems.value = [];
  followSources();
  const shown = ++documentsShown.count;
  extensions.ready = loadExtensions();
  // Waits at least a tick, so the refs are populated before we render. A newer document may still
  // be loading its own extensions when this load ends, so only the latest one draws.
  void extensions.ready.then(() => {
    if (shown === documentsShown.count) renderAll();
  });
  if (charts.value.some((chart) => chartSources(chart).length > 0)) void loadSources();
}

// Maps and 3D load before the charts that use them are drawn. A load that fails
// leaves the chart to say why it could not be drawn.
const extensions: { ready: Promise<void> } = { ready: Promise.resolve() };
// Counts showDocument calls only; loadGeneration also moves with every source read.
const documentsShown = { count: 0 };

async function loadExtensions(): Promise<void> {
  try {
    await loadBrowserExtensions(charts.value.map((chart) => neededExtensions(chart.option)));
  } catch {
    // Reported per chart by the draw that follows.
  }
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

// Format functions hold an Intl formatter built for one locale, so a new locale needs new ones.
watch(
  () => runtime?.locale.value,
  () => renderAll(),
);

function download(href: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function downloadText(text: string, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  download(url, filename);
  // The download reads the URL after click() returns; revoking it at once can leave the file empty.
  setTimeout(() => URL.revokeObjectURL(url));
}

const exportName = (idx: number, chartTitle: string | undefined, extension: string): string =>
  `${fileSlug(chartTitle ?? title.value ?? "chart")}-${idx + 1}.${extension}`;

function exportPng(idx: number, chartTitle?: string): void {
  const instance = instances[idx];
  if (!instance) return;
  const dataUrl = instance.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: EXPORT_BACKGROUND[appearance.value] });
  download(dataUrl, exportName(idx, chartTitle, "png"));
}

// 3D needs WebGL, which the SVG renderer does not have.
const svgExportable = (chart: ChartEntry): boolean => !needsBrowser(neededExtensions(chart.option));

/** Drawn again off screen with the SVG renderer at the card's size: the card draws on a canvas. */
function exportSvg(idx: number, chartTitle?: string): void {
  const instance = instances[idx];
  const option = drawnOptions[idx];
  if (!instance || !option) return;
  const offscreen = echarts.init(null, echartsTheme(), { renderer: "svg", ssr: true, width: instance.getWidth(), height: instance.getHeight() });
  try {
    offscreen.setOption({ animation: false, ...option, backgroundColor: EXPORT_BACKGROUND[appearance.value] });
    downloadText(offscreen.renderToSVGString(), "image/svg+xml", exportName(idx, chartTitle, "svg"));
  } finally {
    offscreen.dispose();
  }
}

// A byte-order mark, so a spreadsheet opens UTF-8 (Japanese labels) as UTF-8.
const UTF8_BOM = "\uFEFF";

function exportCsv(idx: number, chartTitle?: string): void {
  const option = drawnOptions[idx];
  const rows = option ? chartCsvRows(option) : null;
  if (!rows) return;
  downloadText(`${UTF8_BOM}${toCsv(rows)}`, "text/csv;charset=utf-8", exportName(idx, chartTitle, "csv"));
}

// The theme is fixed when a chart is created, so a host switching light / dark redraws them.
watch(appearance, () => renderAll());
</script>
