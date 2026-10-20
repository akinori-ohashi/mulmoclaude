// What a chart's CSV holds and what its files are called. The CSV is the data the chart was
// drawn from: the first dataset whose source is a table (a sheet's rows included), or, for a
// chart with inline data, its category axis against each series' plain values.

type Cell = string | number | boolean | null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const asList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
};

const toCell = (value: unknown): Cell => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (isRecord(value) && "value" in value) return toCell(value.value);
  return JSON.stringify(value);
};

/** A dataset's array-of-arrays source, as rows. */
function datasetRows(option: Record<string, unknown>): Cell[][] | null {
  const tables = asList(option.dataset).flatMap((dataset) =>
    isRecord(dataset) && Array.isArray(dataset.source) && dataset.source.every(Array.isArray) ? [dataset.source] : [],
  );
  const [table] = tables;
  return table ? table.map((row: unknown[]) => row.map(toCell)) : null;
}

/** The category axis's labels against each series' values, when every series is a plain list. */
function categoryRows(option: Record<string, unknown>): Cell[][] | null {
  const axis = [...asList(option.xAxis), ...asList(option.yAxis)].find((candidate) => isRecord(candidate) && Array.isArray(candidate.data));
  if (!isRecord(axis) || !Array.isArray(axis.data)) return null;
  const series = asList(option.series).filter(isRecord);
  if (series.length === 0 || !series.every((entry) => Array.isArray(entry.data))) return null;
  const categories = axis.data.map(toCell);
  const header: Cell[] = ["", ...series.map((entry, index) => (typeof entry.name === "string" ? entry.name : `Series ${index + 1}`))];
  const body = categories.map((category, row) => [category, ...series.map((entry) => toCell(Array.isArray(entry.data) ? entry.data[row] : null))]);
  return [header, ...body];
}

/** The rows a chart's CSV holds, or null when its data has no table shape. */
export function chartCsvRows(option: Record<string, unknown>): Cell[][] | null {
  return datasetRows(option) ?? categoryRows(option);
}

// A spreadsheet runs a cell that starts with one of these as a formula; a leading quote keeps it text.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(cell: Cell): string {
  if (cell === null) return "";
  const text = typeof cell === "string" && FORMULA_START.test(cell) ? `'${cell}` : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}

/** RFC 4180 CSV, lines ended with CRLF. */
export const toCsv = (rows: Cell[][]): string => rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");

/** `text` without dashes at either end. Not a `-+$` regex, which backtracks polynomially on a long run of dashes. */
function trimDashes(text: string): string {
  const start = [...text].findIndex((character) => character !== "-");
  if (start === -1) return "";
  const end = text.length - [...text].reverse().findIndex((character) => character !== "-");
  return text.slice(start, end);
}

/** A file name stem from a title: lowercase letters, digits and dashes, or "chart". */
export function fileSlug(title: string): string {
  const slug = trimDashes(title.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
  return slug === "" ? "chart" : slug;
}
