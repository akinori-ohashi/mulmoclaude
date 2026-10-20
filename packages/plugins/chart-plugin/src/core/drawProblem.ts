// Why a chart could not be drawn. ECharts throws for most broken options (an axis a series
// needs is missing, a dataset it cannot read, an unregistered transform), but drops a series of
// a type it does not know and draws nothing, logging it only in a development build and only
// once per type. So that case is found by comparing what was asked for with what was kept.

import { echarts } from "./charting";
import { DEFAULT_CHART_HEIGHT_PX } from "./layout";
import { asList, isRecord, optionParts, partsList } from "./optionParts";

type DrawTarget = Pick<echarts.ECharts, "setOption" | "getOption">;

// The size the View draws at; a trial needs some size, and a layout problem shows at this one.
const TRIAL_WIDTH_PX = 640;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Map names the option draws on (a `map` series or a `geo` component) that ECharts has not
 *  been given; drawing one throws a TypeError that does not name the map. */
function missingMaps(parts: Record<string, unknown>[]): string[] {
  const holders = [...partsList(parts, "series").filter((series) => isRecord(series) && series.type === "map"), ...partsList(parts, "geo")];
  const names = holders.flatMap((holder) => (isRecord(holder) && typeof holder.map === "string" ? [holder.map] : []));
  return [...new Set(names)].filter((name) => !echarts.getMap(name));
}

// Series types that sit on xAxis/yAxis unless told otherwise. Without the axes a production
// build of ECharts throws "Cannot read properties of undefined", which tells the agent nothing.
const CARTESIAN_BY_DEFAULT = new Set(["line", "bar", "scatter", "effectScatter", "pictorialBar", "candlestick", "boxplot", "heatmap"]);

/** The axes (`xAxis`, `yAxis`) the option's series need but it does not have. */
function missingAxes(parts: Record<string, unknown>[]): string[] {
  const needsAxes = partsList(parts, "series").some(
    (series) => isRecord(series) && CARTESIAN_BY_DEFAULT.has(String(series.type)) && (series.coordinateSystem ?? "cartesian2d") === "cartesian2d",
  );
  if (!needsAxes) return [];
  return ["xAxis", "yAxis"].filter((axis) => partsList(parts, axis).length === 0);
}

/** Series types ECharts dropped because it does not know them. */
function droppedSeriesTypes(chart: DrawTarget, option: Record<string, unknown>): string[] {
  const asked = partsList(optionParts(option), "series").filter(isRecord);
  const kept = new Set(asList(chart.getOption().series).flatMap((series) => (isRecord(series) && typeof series.type === "string" ? [series.type] : [])));
  return [...new Set(asked.map((series) => (typeof series.type === "string" ? series.type : "(none)")))].filter((type) => !kept.has(type));
}

/** Sets `option` on `chart`, and returns why it was not drawn, or null when it was. */
export function setOptionProblem(chart: DrawTarget, option: Record<string, unknown>): string | null {
  const parts = optionParts(option);
  const axes = missingAxes(parts);
  if (axes.length > 0) return `The series need ${axes.join(" and ")}, which the option does not have`;
  const maps = missingMaps(parts);
  if (maps.length > 0) return `No map named ${maps.map((name) => `"${name}"`).join(", ")} is registered`;
  try {
    chart.setOption(option);
  } catch (thrown) {
    return messageOf(thrown);
  }
  const dropped = droppedSeriesTypes(chart, option);
  return dropped.length > 0 ? `Unknown series type ${dropped.map((type) => `"${type}"`).join(", ")}` : null;
}

// What makes an option undrawable is its shape, not its length, and drawing is synchronous:
// a hundred thousand points hold the server for about half a second. So a trial draws only the
// first rows of each data list (a dataset's header row is its first).
const TRIAL_ROWS = 1000;

const firstRows = (holder: unknown, key: string): unknown => {
  if (!isRecord(holder) || !Array.isArray(holder[key])) return holder;
  return { ...holder, [key]: holder[key].slice(0, TRIAL_ROWS) };
};

const mapList = (value: unknown, map: (item: unknown) => unknown): unknown => (Array.isArray(value) ? value.map(map) : map(value));

/** `option` with every series' `data` and every dataset's `source` cut to TRIAL_ROWS. */
export function trialSample(option: Record<string, unknown>): Record<string, unknown> {
  const sampled = { ...option };
  if ("series" in option) sampled.series = mapList(option.series, (series) => firstRows(series, "data"));
  if ("dataset" in option) sampled.dataset = mapList(option.dataset, (dataset) => firstRows(dataset, "source"));
  return sampled;
}

/** Draws `option` once off screen, as the View would, and returns why it failed, or null. */
export function trialDrawProblem(option: Record<string, unknown>, heightPx = DEFAULT_CHART_HEIGHT_PX): string | null {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: TRIAL_WIDTH_PX, height: heightPx });
  try {
    return setOptionProblem(chart, trialSample(option));
  } finally {
    chart.dispose();
  }
}
