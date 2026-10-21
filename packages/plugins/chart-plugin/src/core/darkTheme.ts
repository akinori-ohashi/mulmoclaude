// ECharts' dark theme, plus colours for echarts-gl's 3D axes. echarts-gl draws grid3D's axis lines
// in #333 and gives their labels and names that colour, and the dark theme says nothing about
// grid3D (echarts-gl 2.1.0, ECharts 6.1.0), so on a dark card the labels sink into the background.
// A component takes its theme's values under what the author wrote, so these lose to the author's.

import darkTheme from "echarts/lib/theme/dark.js";

export const DARK_THEME = "mulmo-dark";

export const DARK_GRID_3D = {
  axisLine: { lineStyle: { color: "#b9bdc6" } },
  axisPointer: { lineStyle: { color: "#e5e7eb" } },
  splitLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
};

export const darkThemeWithAxes3D = (): Record<string, unknown> => ({ ...darkTheme, grid3D: DARK_GRID_3D });
