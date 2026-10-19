// Runtime checks for a chart's spreadsheet source — the tool args, a dispatch
// body and a dispatch reply all arrive from outside the type system.

import type { ChartEntry, ChartSource, ChartSourceCell, ChartSourceRows, ReadSourceArgs } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

export function isChartSource(value: unknown): value is ChartSource {
  return isRecord(value) && isNonEmptyString(value.spreadsheet) && isNonEmptyString(value.range);
}

export function isReadSourceArgs(value: unknown): value is ReadSourceArgs {
  return isRecord(value) && value.kind === "readSource" && isChartSource(value.source);
}

const isSourceCell = (value: unknown): value is ChartSourceCell =>
  value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

export function isChartSourceRows(value: unknown): value is ChartSourceRows {
  return Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every(isSourceCell));
}

/** The rows out of a dispatch reply (`{ data: { rows } }`), or null when it holds none. */
export function readSourceReply(raw: unknown): ChartSourceRows | null {
  if (!isRecord(raw) || !isRecord(raw.data)) return null;
  return isChartSourceRows(raw.data.rows) ? raw.data.rows : null;
}

// `source` and `sourceHeader` are ours; the rest of a dataset (dimensions,
// seriesLayoutBy, transform) is the author's and is kept.
const sourcedDataset = (dataset: unknown, rows: ChartSourceRows): Record<string, unknown> => ({
  ...(isRecord(dataset) ? dataset : {}),
  source: rows,
  sourceHeader: true,
});

/** Without `data`: ECharts draws a series' own `data` instead of the dataset, so
 *  inline numbers left in a sourced chart would hide the sheet's. */
const withoutSeriesData = (series: unknown): unknown => {
  if (Array.isArray(series)) return series.map(withoutSeriesData);
  if (!isRecord(series)) return series;
  return Object.fromEntries(Object.entries(series).filter(([key]) => key !== "data"));
};

/**
 * The option to draw: the source's rows as the ECharts dataset. The first row is
 * the header by contract; left to guess, ECharts reads a numeric header (a year,
 * `2025`) as data. With several datasets the first takes the rows, so a later
 * one that transforms it (`fromDatasetIndex: 0`) still works.
 */
export function withSourceRows(option: Record<string, unknown>, rows: ChartSourceRows): Record<string, unknown> {
  const { dataset } = option;
  const datasets = Array.isArray(dataset) ? [sourcedDataset(dataset[0], rows), ...dataset.slice(1)] : sourcedDataset(dataset, rows);
  return "series" in option ? { ...option, dataset: datasets, series: withoutSeriesData(option.series) } : { ...option, dataset: datasets };
}

/** The option a chart is drawn with. A sourced chart shows its rows, or an empty
 *  dataset while they are missing: drawing `option` could show stale inline data
 *  next to the source's error. A host without a runtime can never read the source,
 *  so there `option` is drawn as it is. */
export function chartOption(chart: ChartEntry, rows: ChartSourceRows | undefined, hasRuntime: boolean): Record<string, unknown> {
  if (!chart.source || !hasRuntime) return chart.option;
  return withSourceRows(chart.option, rows ?? []);
}

/** `promise`, or a rejection with `message` once `ms` pass first: a read that never
 *  settles would otherwise leave a sourced chart blank with no problem shown. */
export function settleWithin<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timer: { id: ReturnType<typeof setTimeout> | undefined } = { id: undefined };
  const timeout = new Promise<never>((_, reject) => {
    timer.id = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer.id));
}

/** Each workbook the document reads, once. */
export function sourceSpreadsheets(sources: (ChartSource | undefined)[]): string[] {
  return [...new Set(sources.flatMap((source) => (source ? [source.spreadsheet] : [])))];
}
