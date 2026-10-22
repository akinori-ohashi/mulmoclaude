// `type: "wordCloud"` is drawn by @modernized/echarts-wordcloud, loaded in the browser when a chart
// has one (extensions.ts). The extension reads only `series.data`, so a series reading a sheet range
// gets its words written into `data` here.

import globalDefault from "echarts/lib/model/globalDefault.js";
import { asList, isRecord } from "./optionParts";
import { datasetNamedAmounts, namedAmount, type NamedAmount } from "./seriesDataset";

export type CloudWord = NamedAmount;

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

/** A data item as `{ name, value }` or `[name, value]`. */
const dataWord = (item: unknown): CloudWord | null => {
  if (isRecord(item)) return namedAmount(item.name, item.value);
  return Array.isArray(item) ? namedAmount(item[0], item[1]) : null;
};

/** The series' words: its own data when it has some, else its dataset's rows. The largest MAX_WORDS. */
export function cloudWords(option: Record<string, unknown>, series: Record<string, unknown>): CloudWord[] {
  const own = Array.isArray(series.data) ? series.data.flatMap((item) => dataWord(item) ?? []) : [];
  const words = Array.isArray(series.data) && series.data.length > 0 ? own : datasetNamedAmounts(option, series);
  if (words.length <= MAX_WORDS) return words;
  const kept = new Set([...words].sort((a, b) => b.value - a.value).slice(0, MAX_WORDS));
  return words.filter((word) => kept.has(word));
}

// Rewritten here; anything else on the series (`shape`, `textStyle`, …) goes to the extension as is.
const REWRITTEN = ["data", "datasetIndex", "encode", "sizeRange", "rotationRange", "rotationStep", "gridSize"];

const isColourList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string");

/** The option's own palette, else ECharts' default one (the light and the dark theme share it). */
const paletteOf = (option: Record<string, unknown>): string[] => (isColourList(option.color) ? option.color : globalDefault.color);

/** The colour each of the series' own data items gives itself, by word. */
function authoredColours(series: Record<string, unknown>): Map<string, unknown> {
  const items = Array.isArray(series.data) ? series.data.filter(isRecord) : [];
  return new Map(
    items.flatMap((item) => (isRecord(item.textStyle) && item.textStyle.color !== undefined ? [[String(item.name).trim(), item.textStyle.color]] : [])),
  );
}

// The extension paints a series in one colour unless each word carries its own, so each word is given
// the palette's next one, as ECharts' `colorBy: "data"` would; a colour the author chose is kept.
function colouredWords(option: Record<string, unknown>, series: Record<string, unknown>, words: CloudWord[]): Record<string, unknown>[] {
  if (isRecord(series.textStyle) && series.textStyle.color !== undefined) return words.map((word) => ({ ...word }));
  const palette = paletteOf(option);
  const authored = authoredColours(series);
  return words.map((word, index) => ({ ...word, textStyle: { color: authored.get(word.name) ?? palette[index % palette.length] } }));
}

function cloudSeries(option: Record<string, unknown>, series: Record<string, unknown>): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(series).filter(([key]) => !REWRITTEN.includes(key)));
  return { ...rest, ...cloudStyle(series), data: colouredWords(option, series, cloudWords(option, series)) };
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
