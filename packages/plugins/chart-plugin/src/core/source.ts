// Runtime checks for a chart's spreadsheet source — the tool args, a dispatch
// body and a dispatch reply all arrive from outside the type system.

import type { ChartEntry, ChartSource, ChartSourceCell, ChartSourceGroupBy, ChartSourceRows, ReadSourceArgs } from "./types";
import { groupIntoColumns, matrixToCells } from "./sourceShapes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const isOptionalName = (value: unknown): boolean => value === undefined || isNonEmptyString(value);

const isGroupBy = (value: unknown): value is ChartSourceGroupBy =>
  isRecord(value) && isNonEmptyString(value.column) && isOptionalName(value.x) && isOptionalName(value.value);

/** A cross table cannot also be grouped: the two reshape the same rows in different ways. */
function isSourceShape(value: Record<string, unknown>): boolean {
  if (value.layout !== undefined && value.layout !== "table" && value.layout !== "matrix") return false;
  if (value.groupBy === undefined) return true;
  return isGroupBy(value.groupBy) && value.layout !== "matrix";
}

export function isChartSource(value: unknown): value is ChartSource {
  return isRecord(value) && isNonEmptyString(value.spreadsheet) && isNonEmptyString(value.range) && isSourceShape(value);
}

/** A chart's `sources`, or its single `source`, or none. */
export const chartSources = (chart: ChartEntry): ChartSource[] => chart.sources ?? (chart.source ? [chart.source] : []);

/** The rows of `source` in the shape it asks for. A range not read yet (no header) is left empty. */
export function shapeRows(source: ChartSource, rows: ChartSourceRows): ChartSourceRows {
  if (rows.length === 0) return rows;
  if (source.layout === "matrix") return matrixToCells(rows);
  return source.groupBy ? groupIntoColumns(rows, source.groupBy) : rows;
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
 * The option to draw: each source's rows as an ECharts dataset, the i-th source in `dataset[i]`.
 * The first row is the header by contract; left to guess, ECharts reads a numeric header (a year,
 * `2025`) as data. Datasets after the sources keep what the author wrote, so a later one that
 * transforms a source (`fromDatasetIndex: 0`) still works.
 */
export function withSourceRowsList(option: Record<string, unknown>, rowsList: ChartSourceRows[]): Record<string, unknown> {
  const { dataset } = option;
  const authored = Array.isArray(dataset) ? dataset : [dataset];
  const filled = rowsList.map((rows, index) => sourcedDataset(authored[index], rows));
  const datasets = rowsList.length === 1 && !Array.isArray(dataset) ? filled[0] : [...filled, ...authored.slice(rowsList.length)];
  return "series" in option ? { ...option, dataset: datasets, series: withoutSeriesData(option.series) } : { ...option, dataset: datasets };
}

/** One range's rows as the first dataset. */
export const withSourceRows = (option: Record<string, unknown>, rows: ChartSourceRows): Record<string, unknown> => withSourceRowsList(option, [rows]);

/** The option a chart is drawn with. A sourced chart shows its rows, reshaped as each source
 *  asks, or empty datasets while they are missing: drawing `option` could show stale inline data
 *  next to the source's error. A host without a runtime can never read the source, so there
 *  `option` is drawn as it is. Throws when a source's rows cannot take the shape it asks for. */
export function chartOption(chart: ChartEntry, rowsList: ChartSourceRows[] | undefined, hasRuntime: boolean): Record<string, unknown> {
  const sources = chartSources(chart);
  if (sources.length === 0 || !hasRuntime) return chart.option;
  return withSourceRowsList(
    chart.option,
    sources.map((source, index) => shapeRows(source, rowsList?.[index] ?? [])),
  );
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
