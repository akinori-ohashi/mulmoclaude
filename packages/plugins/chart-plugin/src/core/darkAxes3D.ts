// echarts-gl draws grid3D's axis lines in #333 and gives their labels and names that colour, while
// ECharts' dark theme says nothing about 3D axes (echarts-gl 2.1.0). On a dark card the labels sink
// into the background and the #ccc split lines stand out instead.

import { isRecord } from "./optionParts";

const DARK_GRID_3D: Record<string, unknown> = {
  axisLine: { lineStyle: { color: "#b9bdc6" } },
  axisPointer: { lineStyle: { color: "#e5e7eb" } },
  splitLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
};

/** `defaults` with `authored` laid over it, object by object: what the author wrote wins. */
function underneath(defaults: Record<string, unknown>, authored: unknown): Record<string, unknown> {
  if (!isRecord(authored)) return defaults;
  const merged: Record<string, unknown> = { ...defaults };
  Object.entries(authored).forEach(([key, value]) => {
    const fallback = defaults[key];
    merged[key] = isRecord(fallback) && isRecord(value) ? underneath(fallback, value) : value;
  });
  return merged;
}

/** `option` with each grid3D given axis colours that read on a dark background, under the author's own. */
export function withDarkAxes3D(option: Record<string, unknown>): Record<string, unknown> {
  const { grid3D } = option;
  if (grid3D === undefined) return option;
  const darkGrid = (grid: unknown): Record<string, unknown> => underneath(DARK_GRID_3D, grid);
  return { ...option, grid3D: Array.isArray(grid3D) ? grid3D.map(darkGrid) : darkGrid(grid3D) };
}
