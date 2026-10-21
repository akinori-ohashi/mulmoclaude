// A series that names its rows by `encode` instead of carrying `data`, read the way ECharts reads
// it: the series' dataset (`datasetIndex`, else the first), its header row, and the columns
// `encode.itemName` / `encode.value` name. Used where a series must be handed `data` because what
// draws it does not read a dataset as ECharts itself would (word clouds, maps).

import { asList, isRecord } from "./optionParts";

export interface NamedAmount {
  name: string;
  value: number;
}

/** A finite number, or a string holding one; otherwise null. */
export function amountOf(value: unknown): number | null {
  const amount = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
}

export function namedAmount(name: unknown, value: unknown): NamedAmount | null {
  const text = typeof name === "string" || typeof name === "number" ? String(name).trim() : "";
  const amount = amountOf(value);
  return text !== "" && amount !== null ? { name: text, value: amount } : null;
}

/** Which column `dimension` names: a header name, a column number, or `fallback`. */
function columnOf(dimension: unknown, header: unknown[] | null, fallback: number): number {
  if (typeof dimension === "number") return dimension;
  if (typeof dimension === "string" && header) {
    const index = header.findIndex((cell) => cell !== null && String(cell) === dimension);
    if (index !== -1) return index;
  }
  return fallback;
}

const seriesDataset = (option: Record<string, unknown>, series: Record<string, unknown>): unknown =>
  asList(option.dataset)[typeof series.datasetIndex === "number" ? series.datasetIndex : 0];

/** Whether the series reads a sheet's rows as `withSourceRows` writes them: a header row naming the
 *  columns, then one array per row, found by position. A dataset chosen by id, a transform's output,
 *  rows as objects, a header ECharts is left to guess and columns named by `dimensions` are all read
 *  some other way, so they answer no. */
export function readsSheetRows(option: Record<string, unknown>, series: Record<string, unknown>): boolean {
  if (series.datasetId !== undefined || series.dimensions !== undefined) return false;
  const dataset = seriesDataset(option, series);
  if (!isRecord(dataset) || dataset.dimensions !== undefined) return false;
  return dataset.sourceHeader === true && Array.isArray(dataset.source) && dataset.source.every(Array.isArray);
}

/** The rows of the series' dataset, and whether the first is a header: said so, or no number where the value goes. */
function datasetTable(option: Record<string, unknown>, series: Record<string, unknown>): { header: unknown[] | null; body: unknown[][] } {
  const dataset = seriesDataset(option, series);
  if (!isRecord(dataset) || !Array.isArray(dataset.source)) return { header: null, body: [] };
  const rows = dataset.source.filter((row): row is unknown[] => Array.isArray(row));
  const [first, ...rest] = rows;
  const firstIsHeader = dataset.sourceHeader === true || (dataset.sourceHeader === undefined && first !== undefined && amountOf(first[1]) === null);
  return firstIsHeader ? { header: first ?? null, body: rest } : { header: null, body: rows };
}

/** One `{ name, value }` per row of the series' dataset that has both; the columns are
 *  `encode.itemName` and `encode.value`, else the first and the second. */
export function datasetNamedAmounts(option: Record<string, unknown>, series: Record<string, unknown>): NamedAmount[] {
  const { header, body } = datasetTable(option, series);
  const encode = isRecord(series.encode) ? series.encode : {};
  const nameColumn = columnOf(asList(encode.itemName)[0], header, 0);
  const valueColumn = columnOf(asList(encode.value)[0], header, 1);
  return body.flatMap((row) => namedAmount(row[nameColumn], row[valueColumn]) ?? []);
}
