// A range read from a sheet is a table whose first row is the header. ECharts wants two other
// shapes that a sheet does not naturally hold, so a source can ask for its rows to be reshaped
// before they become the dataset:
// - `layout: "matrix"`: a cross table (categories along the top and down the side) becomes one
//   row per cell, [X, Y, Value], which a heatmap reads.
// - `groupBy`: a long table (Date, Region, Sales) becomes one column per group (Date, East, West),
//   which ECharts draws as one series per column.

import type { ChartSourceCell, ChartSourceGroupBy, ChartSourceRows } from "./types";

export const MATRIX_HEADER: readonly string[] = ["X", "Y", "Value"];

/** One [X, Y, Value] row per cell: X from the header row, Y from the first column. */
export function matrixToCells(rows: ChartSourceRows): ChartSourceRows {
  const [header = [], ...body] = rows;
  const columns = header.slice(1);
  const cells = body.flatMap(([rowLabel = null, ...values]) => columns.map((columnLabel, index) => [columnLabel, rowLabel, values[index] ?? null]));
  return [[...MATRIX_HEADER], ...cells];
}

function columnIndex(header: ChartSourceCell[], name: string): number {
  const index = header.findIndex((cell) => cell !== null && String(cell) === name);
  if (index === -1) throw new Error(`groupBy: no column "${name}" in the range's header (${header.map(String).join(", ")})`);
  return index;
}

/** The first header column that is none of `taken`. */
function firstOtherColumn(header: ChartSourceCell[], taken: number[], role: string): number {
  const index = header.findIndex((_, column) => !taken.includes(column));
  if (index === -1) throw new Error(`groupBy: the range has no column left for ${role}`);
  return index;
}

const uniqueInOrder = (values: ChartSourceCell[]): ChartSourceCell[] => [...new Map(values.map((value) => [String(value), value])).values()];

/** Several rows meeting in one cell are added up when they are all numbers; otherwise the last one counts. */
function combine(cells: ChartSourceCell[]): ChartSourceCell {
  const present = cells.filter((cell) => cell !== null);
  if (present.length === 0) return null;
  if (present.every((cell): cell is number => typeof cell === "number")) return present.reduce((sum, cell) => sum + cell, 0);
  return present[present.length - 1] ?? null;
}

/** One column per value of `groupBy.column`, one row per value of `groupBy.x`, holding `groupBy.value`. */
export function groupIntoColumns(rows: ChartSourceRows, groupBy: ChartSourceGroupBy): ChartSourceRows {
  const [header = [], ...body] = rows;
  const group = columnIndex(header, groupBy.column);
  const x = groupBy.x === undefined ? firstOtherColumn(header, [group], "x") : columnIndex(header, groupBy.x);
  const value = groupBy.value === undefined ? firstOtherColumn(header, [group, x], "the value") : columnIndex(header, groupBy.value);
  const groups = uniqueInOrder(body.map((row) => row[group] ?? null));
  const xs = uniqueInOrder(body.map((row) => row[x] ?? null));
  const keyOf = (xValue: ChartSourceCell, groupValue: ChartSourceCell): string => JSON.stringify([String(xValue), String(groupValue)]);
  const meeting = body.reduce((cells, row) => {
    const key = keyOf(row[x] ?? null, row[group] ?? null);
    cells.set(key, [...(cells.get(key) ?? []), row[value] ?? null]);
    return cells;
  }, new Map<string, ChartSourceCell[]>());
  const cellAt = (xValue: ChartSourceCell, groupValue: ChartSourceCell): ChartSourceCell => combine(meeting.get(keyOf(xValue, groupValue)) ?? []);
  return [
    [header[x] ?? null, ...groups.map((groupValue) => String(groupValue))],
    ...xs.map((xValue) => [xValue, ...groups.map((groupValue) => cellAt(xValue, groupValue))]),
  ];
}
