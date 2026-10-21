// `type: "wordCloud"` drawn without echarts-wordcloud (which declares ECharts 5): each such series
// becomes a `custom` series that lays its words out for the chart's size (wordCloudLayout.ts) and
// draws each as text. So a word cloud is drawn on the server's trial draw and exported as SVG
// like any other chart.

import type { CustomSeriesRenderItem, CustomSeriesRenderItemAPI, CustomSeriesRenderItemParams, CustomSeriesRenderItemReturn } from "echarts";
import { asList, isRecord } from "./optionParts";
import { estimateTextWidth, layoutWords, type CloudStyle, type CloudWord, type MeasureText, type PlacedWord } from "./wordCloudLayout";

const WORD_CLOUD = "wordCloud";

const DEFAULT_STYLE: CloudStyle = { sizeRange: [12, 60], rotationRange: [0, 90], rotationStep: 90, gridSize: 8 };
const MIN_FONT_PX = 4;
const MAX_FONT_PX = 400;
const MAX_ROTATION_DEG = 90;
const MIN_ROTATION_STEP_DEG = 1;
const GRID_RANGE_PX: readonly [number, number] = [2, 64];
// The largest values are kept; more words than this do not fit a card anyway.
const MAX_WORDS = 300;
const DEGREES_TO_RAD = Math.PI / 180;

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

const DEFAULT_FONT_FAMILY = "sans-serif";

/** The browser's own text width for the font the words are drawn in; the estimate without a canvas. */
function textMeasure(fonts: Record<string, unknown>): MeasureText {
  const context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!context) return estimateTextWidth;
  const weight = typeof fonts.fontWeight === "string" ? fonts.fontWeight : "normal";
  const family = typeof fonts.fontFamily === "string" ? fonts.fontFamily : DEFAULT_FONT_FAMILY;
  return (text, fontSize) => {
    context.font = `${weight} ${fontSize}px ${family}`;
    return context.measureText(text).width;
  };
}

/** Layouts kept per chart size, so a redraw at the same size does not lay the words out again. */
function layoutsBySize(words: CloudWord[], style: CloudStyle, measure: MeasureText): (width: number, height: number) => Map<number, PlacedWord> {
  const layouts = new Map<string, Map<number, PlacedWord>>();
  return (width, height) => {
    const key = `${width}x${height}`;
    const known = layouts.get(key);
    if (known) return known;
    const placed = new Map(layoutWords(words, style, { width, height }, measure).map((word) => [word.index, word]));
    layouts.set(key, placed);
    return placed;
  };
}

const textStyleOf = (series: Record<string, unknown>): Record<string, unknown> => {
  const { textStyle } = series;
  if (!isRecord(textStyle)) return {};
  return Object.fromEntries(["fontFamily", "fontWeight"].flatMap((key) => (typeof textStyle[key] === "string" ? [[key, textStyle[key]]] : [])));
};

/** One placed word as an ECharts text element. */
function wordText(word: PlacedWord, text: string, fonts: Record<string, unknown>, color: unknown): CustomSeriesRenderItemReturn {
  return {
    type: "text",
    x: word.x,
    y: word.y,
    rotation: word.rotationDeg * DEGREES_TO_RAD,
    style: { ...fonts, text, fontSize: word.fontSize, ...(typeof color === "string" ? { fill: color } : {}), align: "center", verticalAlign: "middle" },
  };
}

function renderWords(words: CloudWord[], style: CloudStyle, series: Record<string, unknown>): CustomSeriesRenderItem {
  const fonts = textStyleOf(series);
  const layoutFor = layoutsBySize(words, style, textMeasure(fonts));
  return (params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
    const word = layoutFor(api.getWidth(), api.getHeight()).get(params.dataIndex);
    return word ? wordText(word, words[params.dataIndex]?.name ?? "", fonts, api.visual("color")) : null;
  };
}

const SETTINGS = ["type", "data", "datasetIndex", "encode", "sizeRange", "rotationRange", "rotationStep", "gridSize", "textStyle"];

function cloudSeries(option: Record<string, unknown>, series: Record<string, unknown>): Record<string, unknown> {
  const words = cloudWords(option, series);
  const rest = Object.fromEntries(Object.entries(series).filter(([key]) => !SETTINGS.includes(key)));
  return {
    colorBy: "data",
    ...rest,
    type: "custom",
    coordinateSystem: "none",
    data: words.map(({ name, value }) => ({ name, value })),
    renderItem: renderWords(words, cloudStyle(series), series),
  };
}

const isWordCloud = (series: unknown): series is Record<string, unknown> => isRecord(series) && series.type === WORD_CLOUD;

/** `option` with each top-level `wordCloud` series drawn as a `custom` series. Anything else is kept. */
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
