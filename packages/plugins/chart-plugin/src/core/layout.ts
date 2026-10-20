// How tall each chart is and how many cards sit side by side. Both come from the agent, so they
// are kept within what the canvas can show: a chart too short loses its axes, one too tall hides
// the next, and more than four columns leave each chart narrower than its labels.

import type { ChartDocument, ChartEntry } from "./types";

export const DEFAULT_CHART_HEIGHT_PX = 400;
export const MIN_CHART_HEIGHT_PX = 160;
export const MAX_CHART_HEIGHT_PX = 1200;
export const MAX_COLUMNS = 4;

/** The height a chart is drawn at: its own `height`, kept between the limits, or the default. */
export function chartHeightPx(chart: Pick<ChartEntry, "height">): number {
  const { height } = chart;
  if (height === undefined || !Number.isFinite(height)) return DEFAULT_CHART_HEIGHT_PX;
  return Math.round(Math.min(MAX_CHART_HEIGHT_PX, Math.max(MIN_CHART_HEIGHT_PX, height)));
}

/** How many cards sit side by side: the document's `columns`, from 1 to MAX_COLUMNS. */
export function documentColumns(document: Pick<ChartDocument, "columns"> | undefined): number {
  const columns = document?.columns;
  if (columns === undefined || !Number.isFinite(columns)) return 1;
  return Math.min(MAX_COLUMNS, Math.max(1, Math.floor(columns)));
}

// Whole class names, so Tailwind finds them in the source.
const GRID_COLUMN_CLASSES = ["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"] as const;

export const gridColumnsClass = (columns: number): string => GRID_COLUMN_CLASSES[Math.min(MAX_COLUMNS, Math.max(1, columns)) - 1] ?? "grid-cols-1";
