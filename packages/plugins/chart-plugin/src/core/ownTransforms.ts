// Dataset transforms of our own, for what ecStat and ECharts lack: a clustering that does not
// change on redraw, and a boxplot of a sheet's columns. The maths lives in kMeans.ts and
// columnBoxes.ts; this only reads the upstream dataset and writes the result.

import type * as echarts from "echarts";
import { kMeans, type Point } from "./kMeans";
import { boxOf, cellNumber, type BoundIqr } from "./columnBoxes";

type ExternalTransform = Parameters<typeof echarts.registerTransform>[0];
type TransformParam = Parameters<ExternalTransform["transform"]>[0];
type Upstream = TransformParam["upstream"];
type Dimension = string | number;
type CellValue = ReturnType<Upstream["retrieveValue"]>;

export const CLUSTERING_TRANSFORM = "mulmo:clustering";
export const COLUMN_BOXPLOT_TRANSFORM = "mulmo:boxplotColumns";

const DEFAULT_CLUSTER_DIMENSION = "Cluster";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isDimension = (value: unknown): value is Dimension => typeof value === "string" || (typeof value === "number" && Number.isInteger(value));

const dimensionNames = (upstream: Upstream): string[] => upstream.cloneAllDimensionInfo().map((info) => info.name ?? String(info.index));

function dimensionIndex(upstream: Upstream, dimension: Dimension, transform: string): number {
  const info = upstream.getDimensionInfo(dimension);
  if (!info) throw new Error(`${transform}: no column "${dimension}" in the dataset`);
  return info.index;
}

const columnValues = (upstream: Upstream, column: number): (number | null)[] =>
  Array.from({ length: upstream.count() }, (_, row) => cellNumber(upstream.retrieveValue(row, column)));

/** `config.dimensions` as column indexes; left out, every column holding a number (not the labels). */
function configDimensions(upstream: Upstream, config: Record<string, unknown>, transform: string): number[] {
  const { dimensions } = config;
  if (dimensions === undefined) {
    return dimensionNames(upstream).flatMap((_, column) => (columnValues(upstream, column).some((value) => value !== null) ? [column] : []));
  }
  if (!Array.isArray(dimensions) || dimensions.length === 0 || !dimensions.every(isDimension)) {
    throw new Error(`${transform}: config.dimensions must be a non-empty list of column names or indexes`);
  }
  return dimensions.map((dimension) => dimensionIndex(upstream, dimension, transform));
}

const configOf = (param: TransformParam): Record<string, unknown> => (isRecord(param.config) ? param.config : {});

const rowAt = (upstream: Upstream, row: number, width: number): CellValue[] =>
  Array.from({ length: width }, (_, column) => upstream.retrieveValue(row, column));

function clusterCountOf(config: Record<string, unknown>): number {
  const { clusterCount } = config;
  if (typeof clusterCount !== "number" || !Number.isInteger(clusterCount) || clusterCount < 1) {
    throw new Error(`${CLUSTERING_TRANSFORM}: config.clusterCount must be a whole number of at least 1`);
  }
  return clusterCount;
}

const isNumber = (value: number | null): value is number => value !== null;

/** The row's chosen columns as a point, or null when one of them is not a number. */
function readPoint(row: unknown[], columns: number[]): Point | null {
  const values = columns.map((column) => cellNumber(row[column]));
  const point = values.filter(isNumber);
  return point.length === values.length ? point : null;
}

/** The rows whose chosen columns are all numbers, each with its cluster appended as a new column. */
function clustering(param: TransformParam): ReturnType<ExternalTransform["transform"]> {
  const { upstream } = param;
  const config = configOf(param);
  const clusterCount = clusterCountOf(config);
  const dimensions = configDimensions(upstream, config, CLUSTERING_TRANSFORM);
  const output = typeof config.outputClusterIndexDimension === "string" ? config.outputClusterIndexDimension : DEFAULT_CLUSTER_DIMENSION;
  const names = dimensionNames(upstream);
  const rows = Array.from({ length: upstream.count() }, (_, index) => rowAt(upstream, index, names.length));
  const readable = rows.flatMap((row) => {
    const point = readPoint(row, dimensions);
    return point ? [{ row, point }] : [];
  });
  const labels = kMeans(
    readable.map(({ point }) => point),
    clusterCount,
  );
  return { dimensions: [...names, output], data: readable.map(({ row }, index) => [...row, labels[index] ?? 0]) };
}

function boundIqrOf(config: Record<string, unknown>): BoundIqr | undefined {
  const { boundIQR } = config;
  if (boundIQR === undefined || boundIQR === "none" || (typeof boundIQR === "number" && boundIQR >= 0)) return boundIQR;
  throw new Error(`${COLUMN_BOXPLOT_TRANSFORM}: config.boundIQR must be a number of at least 0, or "none"`);
}

/** One box per column ([Column, Low, Q1, Median, Q3, High]), then the outliers ([Column, Value]).
 *  A column with no numbers (the label column) is left out unless it is named. */
function columnBoxplot(param: TransformParam): ReturnType<ExternalTransform["transform"]> {
  const { upstream } = param;
  const config = configOf(param);
  const boundIqr = boundIqrOf(config);
  const names = dimensionNames(upstream);
  const columns = configDimensions(upstream, config, COLUMN_BOXPLOT_TRANSFORM);
  const boxes = columns.flatMap((column) => {
    const box = boxOf(names[column] ?? String(column), columnValues(upstream, column).filter(isNumber), boundIqr);
    return box ? [box] : [];
  });
  return [
    { dimensions: ["Column", "Low", "Q1", "Median", "Q3", "High"], data: boxes.map(({ name, box }) => [name, ...box]) },
    { dimensions: ["Column", "Value"], data: boxes.flatMap(({ name, outliers }) => outliers.map((value) => [name, value])) },
  ];
}

export const OWN_TRANSFORMS: ExternalTransform[] = [
  { type: CLUSTERING_TRANSFORM, transform: clustering },
  { type: COLUMN_BOXPLOT_TRANSFORM, transform: columnBoxplot },
];
