// `type: "wordCloud"` is drawn by @modernized/echarts-wordcloud, loaded in the browser when a chart
// has one (extensions.ts). The extension reads only `series.data`, so a series reading a sheet range
// gets its words written into `data` here.

import { asList, isRecord } from "./optionParts";

export interface CloudWord {
  name: string;
  value: number;
}

export interface CloudStyle {
  /** Font sizes in px for the smallest and the largest value. */
  sizeRange: readonly [number, number];
  /** Degrees; each word takes one angle from this range, `rotationStep` apart. */
  rotationRange: readonly [number, number];
  rotationStep: number;
  /** Cell size in px of the grid that marks taken space; larger leaves more room between words. */
  gridSize: number;
}

const WORD_CLOUD = "wordCloud";

const DEFAULT_STYLE: CloudStyle = { sizeRange: [12, 60], rotationRange: [0, 90], rotationStep: 90, gridSize: 8 };
const MIN_FONT_PX = 4;
const MAX_FONT_PX = 400;
const MAX_ROTATION_DEG = 90;
const MIN_ROTATION_STEP_DEG = 1;
const GRID_RANGE_PX: readonly [number, number] = [4, 64];
// The largest values are kept; more words than this do not fit a card anyway.
const MAX_WORDS = 300;

const isNumberPair = (value: unknown, [min, max]: readonly [number, number]): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((entry) => typeof entry === "number" && entry >= min && entry <= max) &&
  Number(value[0]) <= Number(value[1]);

const numberWithin = (value: unknown, [min, max]: readonly [number, number], fallback: number): number =>
  typeof value === "number" && value >= min && value <= max ? value : fallback;

/** The series' layout settings, each replaced by its default when missing or out of range. */
export function cloudStyle(series: Record<string, unknown>): CloudStyle {
  return {
    sizeRange: isNumberPair(series.sizeRange, [MIN_FONT_PX, MAX_FONT_PX]) ? series.sizeRange : DEFAULT_STYLE.sizeRange,
    rotationRange: isNumberPair(series.rotationRange, [-MAX_ROTATION_DEG, MAX_ROTATION_DEG]) ? series.rotationRange : DEFAULT_STYLE.rotationRange,
    rotationStep: numberWithin(series.rotationStep, [MIN_ROTATION_STEP_DEG, MAX_ROTATION_DEG * 2], DEFAULT_STYLE.rotationStep),
    gridSize: numberWithin(series.gridSize, GRID_RANGE_PX, DEFAULT_STYLE.gridSize),
  };
}

/** A word's value: a finite number, or a string holding one; otherwise null. */
function wordAmount(value: unknown): number | null {
  const amount = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
}

function cloudWord(name: unknown, value: unknown): CloudWord | null {
  const text = typeof name === "string" || typeof name === "number" ? String(name).trim() : "";
  const amount = wordAmount(value);
  return text !== "" && amount !== null ? { name: text, value: amount } : null;
}

/** A data item as `{ name, value }` or `[name, value]`. */
const dataWord = (item: unknown): CloudWord | null => {
  if (isRecord(item)) return cloudWord(item.name, item.value);
  return Array.isArray(item) ? cloudWord(item[0], item[1]) : null;
};

/** Which column `dimension` names: a header name, a column number, or `fallback`. */
function columnOf(dimension: unknown, header: unknown[] | null, fallback: number): number {
  if (typeof dimension === "number") return dimension;
  if (typeof dimension === "string" && header) {
    const index = header.findIndex((cell) => cell !== null && String(cell) === dimension);
    if (index !== -1) return index;
  }
  return fallback;
}

/** The rows of the series' dataset, and whether the first is a header: said so, or no number where the value goes. */
function datasetTable(option: Record<string, unknown>, series: Record<string, unknown>): { header: unknown[] | null; body: unknown[][] } {
  const dataset = asList(option.dataset)[typeof series.datasetIndex === "number" ? series.datasetIndex : 0];
  if (!isRecord(dataset) || !Array.isArray(dataset.source)) return { header: null, body: [] };
  const rows = dataset.source.filter((row): row is unknown[] => Array.isArray(row));
  const [first, ...rest] = rows;
  const firstIsHeader = dataset.sourceHeader === true || (dataset.sourceHeader === undefined && first !== undefined && wordAmount(first[1]) === null);
  return firstIsHeader ? { header: first ?? null, body: rest } : { header: null, body: rows };
}

function datasetWords(option: Record<string, unknown>, series: Record<string, unknown>): CloudWord[] {
  const { header, body } = datasetTable(option, series);
  const encode = isRecord(series.encode) ? series.encode : {};
  const nameColumn = columnOf(asList(encode.itemName)[0], header, 0);
  const valueColumn = columnOf(asList(encode.value)[0], header, 1);
  return body.flatMap((row) => cloudWord(row[nameColumn], row[valueColumn]) ?? []);
}

/** The series' words: its own data when it has some, else its dataset's rows. The largest MAX_WORDS. */
export function cloudWords(option: Record<string, unknown>, series: Record<string, unknown>): CloudWord[] {
  const own = Array.isArray(series.data) ? series.data.flatMap((item) => dataWord(item) ?? []) : [];
  const words = Array.isArray(series.data) && series.data.length > 0 ? own : datasetWords(option, series);
  if (words.length <= MAX_WORDS) return words;
  const kept = new Set([...words].sort((a, b) => b.value - a.value).slice(0, MAX_WORDS));
  return words.filter((word) => kept.has(word));
}

// Rewritten here; anything else on the series (`shape`, `textStyle`, …) goes to the extension as is.
const REWRITTEN = ["data", "datasetIndex", "encode", "sizeRange", "rotationRange", "rotationStep", "gridSize"];

function cloudSeries(option: Record<string, unknown>, series: Record<string, unknown>): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(series).filter(([key]) => !REWRITTEN.includes(key)));
  return { ...rest, ...cloudStyle(series), data: cloudWords(option, series) };
}

const isWordCloud = (series: unknown): series is Record<string, unknown> => isRecord(series) && series.type === WORD_CLOUD;

/** `option` with each top-level `wordCloud` series given its words and settings. Anything else is kept. */
export function withWordClouds(option: Record<string, unknown>): Record<string, unknown> {
  const { series } = option;
  if (!asList(series).some(isWordCloud)) return option;
  const drawn = (entry: unknown): unknown => (isWordCloud(entry) ? cloudSeries(option, entry) : entry);
  return { ...option, series: Array.isArray(series) ? series.map(drawn) : drawn(series) };
}

/** Why the option's word clouds cannot be drawn, or null. A timeline writes a series' type in
 *  `baseOption` and its data in each of `options`, which this rewrite does not merge. */
export function wordCloudProblem(option: Record<string, unknown>): string | null {
  const timelineParts = [...asList(option.baseOption), ...asList(option.options)].filter(isRecord);
  const nested = timelineParts.some((part) => asList(part.series).some(isWordCloud));
  return nested ? "A wordCloud series works only in the option's own series, not inside a timeline's baseOption or options" : null;
}
