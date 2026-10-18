// Runtime checks for a chart's spreadsheet source — the tool args, a dispatch
// body and a dispatch reply all arrive from outside the type system.

import type { ChartSource, ChartSourceCell, ChartSourceRows, ReadSourceArgs } from "./types";

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

/** The option to draw: the source's rows as the ECharts dataset, replacing any inline one.
 *  The first row is the header by contract; left to guess, ECharts reads a numeric
 *  header (a year, `2025`) as data. */
export function withSourceRows(option: Record<string, unknown>, rows: ChartSourceRows): Record<string, unknown> {
  return { ...option, dataset: { source: rows, sourceHeader: true } };
}

/** What a document's sources are, as one comparable string: a change means the
 *  View must read and subscribe again. */
export const sourcesSignature = (sources: (ChartSource | undefined)[]): string => JSON.stringify(sources.map((source) => source ?? null));

/** Each workbook the document reads, once. */
export function sourceSpreadsheets(sources: (ChartSource | undefined)[]): string[] {
  return [...new Set(sources.flatMap((source) => (source ? [source.spreadsheet] : [])))];
}
