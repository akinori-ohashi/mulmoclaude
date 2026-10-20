// Why a chart could not be drawn. ECharts throws for most broken options (an axis a series
// needs is missing, a dataset it cannot read, an unregistered transform), but drops a series of
// a type it does not know and draws nothing, logging it only in a development build and only
// once per type. So that case is found by comparing what was asked for with what was kept.

import { echarts } from "./charting";

type DrawTarget = Pick<echarts.ECharts, "setOption" | "getOption">;

// The size the View draws at; a trial needs some size, and a layout problem shows at this one.
const TRIAL_WIDTH_PX = 640;
const TRIAL_HEIGHT_PX = 400;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Map names the option draws on (a `map` series or a `geo` component) that ECharts has not
 *  been given; drawing one throws a TypeError that does not name the map. */
function missingMaps(option: Record<string, unknown>): string[] {
  const holders = [...asList(option.series).filter((series) => isRecord(series) && series.type === "map"), ...asList(option.geo)];
  const names = holders.flatMap((holder) => (isRecord(holder) && typeof holder.map === "string" ? [holder.map] : []));
  return [...new Set(names)].filter((name) => !echarts.getMap(name));
}

// Series types that sit on xAxis/yAxis unless told otherwise. Without the axes a production
// build of ECharts throws "Cannot read properties of undefined", which tells the agent nothing.
const CARTESIAN_BY_DEFAULT = new Set(["line", "bar", "scatter", "effectScatter", "pictorialBar", "candlestick", "boxplot", "heatmap"]);

/** The axes (`xAxis`, `yAxis`) the option's series need but it does not have. */
function missingAxes(option: Record<string, unknown>): string[] {
  const needsAxes = asList(option.series).some(
    (series) => isRecord(series) && CARTESIAN_BY_DEFAULT.has(String(series.type)) && (series.coordinateSystem ?? "cartesian2d") === "cartesian2d",
  );
  if (!needsAxes) return [];
  return ["xAxis", "yAxis"].filter((axis) => asList(option[axis]).length === 0);
}

/** Series types ECharts dropped because it does not know them. */
function droppedSeriesTypes(chart: DrawTarget, option: Record<string, unknown>): string[] {
  const asked = asList(option.series).filter(isRecord);
  const kept = new Set(asList(chart.getOption().series).flatMap((series) => (isRecord(series) && typeof series.type === "string" ? [series.type] : [])));
  return [...new Set(asked.map((series) => (typeof series.type === "string" ? series.type : "(none)")))].filter((type) => !kept.has(type));
}

/** Sets `option` on `chart`, and returns why it was not drawn, or null when it was. */
export function setOptionProblem(chart: DrawTarget, option: Record<string, unknown>): string | null {
  const axes = missingAxes(option);
  if (axes.length > 0) return `The series need ${axes.join(" and ")}, which the option does not have`;
  const maps = missingMaps(option);
  if (maps.length > 0) return `No map named ${maps.map((name) => `"${name}"`).join(", ")} is registered`;
  try {
    chart.setOption(option);
  } catch (thrown) {
    return messageOf(thrown);
  }
  const dropped = droppedSeriesTypes(chart, option);
  return dropped.length > 0 ? `Unknown series type ${dropped.map((type) => `"${type}"`).join(", ")}` : null;
}

/** Draws `option` once off screen, as the View would, and returns why it failed, or null. */
export function trialDrawProblem(option: Record<string, unknown>): string | null {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: TRIAL_WIDTH_PX, height: TRIAL_HEIGHT_PX });
  try {
    return setOptionProblem(chart, option);
  } finally {
    chart.dispose();
  }
}
