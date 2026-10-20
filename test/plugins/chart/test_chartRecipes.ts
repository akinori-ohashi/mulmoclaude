// The recipes in presentChart's description are the options an agent copies, so each one is
// drawn here the way the View draws it: through `withSourceRows` when it reads a range, then by
// ECharts itself. A recipe that throws, warns, or leaves a series empty fails.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHART_RECIPES, type ChartRecipe } from "../../../packages/plugins/chart-plugin/src/core/recipes";
import { TOOL_DEFINITION } from "../../../packages/plugins/chart-plugin/src/core/definition";
import { withSourceRows } from "../../../packages/plugins/chart-plugin/src/core/source";
import type { ChartSourceRows } from "../../../packages/plugins/chart-plugin/src/core/types";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";
import { trialDrawProblem } from "../../../packages/plugins/chart-plugin/src/core/drawProblem";
import { formatProblem, withFormatters } from "../../../packages/plugins/chart-plugin/src/core/formats";
import { BUNDLED_MAPS, loadMaps } from "../../../packages/plugins/chart-plugin/src/core/extensions";

// Claude Code cuts an MCP tool's top-level description here (CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH)
// and passes property descriptions whole, which is why the recipes sit on `option`.
const CLAUDE_CODE_DESCRIPTION_LIMIT = 2048;

// Points lying exactly on y = a·e^(bx), so any exponential fit must pass through them.
const EXPONENTIAL_SCALE = 50;
const EXPONENTIAL_RATE = 0.05;
const onExponential = (spend: number): number => EXPONENTIAL_SCALE * Math.exp(EXPONENTIAL_RATE * spend);
const FIT_TOLERANCE = 1e-6;

const CHART_WIDTH_PX = 640;
const CHART_HEIGHT_PX = 400;

/** Sample rows under each sourced recipe's header, keyed by the header itself. */
const SAMPLE_ROWS: Record<string, ChartSourceRows> = {
  "Temp|Sales": [
    ["Temp", "Sales"],
    [18, 120],
    [25, 210],
    [31, 260],
  ],
  "Temp|Sales|Fit": [
    ["Temp", "Sales", "Fit"],
    [31, 260, 270],
    [18, 120, 115],
    [25, 210, 198],
  ],
  "Spend|Sales": [
    ["Spend", "Sales"],
    [30, onExponential(30)],
    [10, onExponential(10)],
    [40, onExponential(40)],
    [20, onExponential(20)],
  ],
  Score: [["Score"], [3], [7], [12], [18], [19], [25], [26], [27], [41]],
  "Category|Sales": [
    ["Category", "Sales"],
    ["Coffee", 300],
    ["Tea", 120],
  ],
  "Group|Min|Q1|Median|Q3|Max": [
    ["Group", "Min", "Q1", "Median", "Q3", "Max"],
    ["A", 1, 2, 3, 4, 10],
    ["B", 5, 6, 6.5, 7, 9],
  ],
  "Bin|Count": [
    ["Bin", "Count"],
    ["0-10", 4],
    ["10-20", 9],
    ["20-30", 2],
  ],
  "Month|Sales|Growth %": [
    ["Month", "Sales", "Growth %"],
    ["Jan", 100, 0],
    ["Feb", 120, 20],
  ],
  "Cause|Count|Cum %": [
    ["Cause", "Count", "Cum %"],
    ["Late", 50, 62.5],
    ["Broken", 30, 100],
  ],
  "Month|A|B": [
    ["Month", "A", "B"],
    ["Jan", 3, 4],
    ["Feb", 5, 2],
  ],
  "Step|Base|Up|Down": [
    ["Step", "Base", "Up", "Down"],
    ["Start", 0, 100, 0],
    ["Sales", 100, 40, 0],
    ["Costs", 110, 0, 30],
    ["End", 0, 110, 0],
  ],
  "Date|Visits": [
    ["Date", "Visits"],
    ["2026-01-05", 30],
    ["2026-01-12", 42],
  ],
  "Month|Sales": [
    ["Month", "Sales"],
    ["Jan", 100],
    ["Feb", 140],
    ["Mar", 90],
  ],
  "Year|Users": [
    ["Year", "Users"],
    ["2024", 10],
    ["2025", 1000],
  ],
  "X|Y|Value": [
    ["X", "Y", "Value"],
    ["Sales", "Temp", 0.8],
    ["Temp", "Sales", 0.8],
    ["Sales", "Sales", 1],
  ],
  "Date|Open|Close|Low|High": [
    ["Date", "Open", "Close", "Low", "High"],
    ["2026-01-05", 10, 12, 9, 13],
    ["2026-01-06", 12, 11, 10, 14],
  ],
  "Week|Store A|Store B": [
    ["Week", "Store A", "Store B"],
    ["W1", 10, 30],
    ["W2", 12, 31],
    ["W3", 11, 29],
    ["W4", 13, 90],
    ["W5", null, 32],
  ],
  "Name|Income|Spend": [
    ["Name", "Income", "Spend"],
    ["a", 10, 11],
    ["b", 90, 88],
    ["c", 12, 9],
    ["d", 91, 92],
  ],
  "Prefecture|Sales": [
    ["Prefecture", "Sales"],
    ["Tokyo", 90],
    ["Osaka", 60],
  ],
  "Date|Revenue": [
    ["Date", "Revenue"],
    ["2026-01-01", 1234567],
    ["2026-02-01", 2345678],
  ],
  "Time|Value": [
    ["Time", "Value"],
    ["t1", 1],
    ["t2", 3],
  ],
};

const expectedShape = (type: string, columns: string[], stack?: string): SeriesShape => ({ type, columns, stack });

/** For each sourced recipe, keyed by its header: every series' type, value columns and stack. */
const EXPECTED_SHAPES: Record<string, SeriesShape[]> = {
  "Temp|Sales": [expectedShape("scatter", ["Sales"])],
  "Temp|Sales|Fit": [expectedShape("scatter", ["Sales"]), expectedShape("line", ["Fit"])],
  "Spend|Sales": [expectedShape("scatter", ["Sales"]), expectedShape("line", ["Sales"])],
  Score: [expectedShape("bar", ["VCount"])],
  "Category|Sales": [expectedShape("pie", ["Sales"])],
  "Group|Min|Q1|Median|Q3|Max": [expectedShape("boxplot", ["Min", "Q1", "Median", "Q3", "Max"])],
  "Bin|Count": [expectedShape("bar", ["Count"])],
  "Month|Sales|Growth %": [expectedShape("bar", ["Sales"]), expectedShape("line", ["Growth %"])],
  "Cause|Count|Cum %": [expectedShape("bar", ["Count"]), expectedShape("line", ["Cum %"])],
  "Month|A|B": [expectedShape("bar", ["A"], "total"), expectedShape("bar", ["B"], "total")],
  "Step|Base|Up|Down": [expectedShape("bar", ["Base"], "w"), expectedShape("bar", ["Up"], "w"), expectedShape("bar", ["Down"], "w")],
  "Date|Visits": [expectedShape("line", ["Visits"])],
  "Month|Sales": [expectedShape("line", ["Sales"])],
  "Year|Users": [expectedShape("line", ["Users"])],
  "X|Y|Value": [expectedShape("heatmap", ["Value"])],
  "Date|Open|Close|Low|High": [expectedShape("candlestick", ["Open", "Close", "Low", "High"])],
  "Date|Revenue": [expectedShape("bar", ["Revenue"])],
  "Prefecture|Sales": [expectedShape("map", ["Sales"])],
  "Week|Store A|Store B": [expectedShape("boxplot", ["Low", "Q1", "Median", "Q3", "High"]), expectedShape("scatter", ["y"])],
  "Name|Income|Spend": [expectedShape("scatter", ["Spend"])],
  "Time|Value": [expectedShape("line", ["Value"])],
};

function sampleRows(recipe: ChartRecipe): ChartSourceRows | null {
  if (!recipe.header) return null;
  const rows = SAMPLE_ROWS[recipe.header.join("|")];
  assert.ok(rows, `no sample rows for "${recipe.use}"`);
  assert.deepEqual(rows[0], [...recipe.header], `sample header for "${recipe.use}"`);
  return rows;
}

type Coordinate = "x" | "y" | "value";
const COORDINATES: readonly Coordinate[] = ["x", "y", "value"];

interface DrawnSeries {
  count: number;
  /** Each item's values on the dimensions mapped to a coordinate, in encode's order. */
  values: Record<Coordinate, unknown[][]>;
  /** Each item's top after stacking, when the series is stacked. */
  stackTops: unknown[] | null;
  yAxisIndex: unknown;
  calendars: number;
  /** What the series is, read back from ECharts: its type, the columns its values come from, its stack. */
  shape: SeriesShape;
}

interface SeriesShape {
  type: unknown;
  columns: unknown;
  stack: unknown;
}

interface Drawn {
  warnings: string[];
  series: DrawnSeries[];
}

function captureWarnings<T>(draw: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  console.error = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    return { result: draw(), warnings };
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

// The public API exposes no series data, so the drawn data is read from ECharts' model, which is
// private: its published types say nothing about it, hence `unknown` and the checks.
function callMethod(target: unknown, method: string, ...args: unknown[]): unknown {
  assert.ok(typeof target === "object" && target !== null, `no object for ${method}`);
  const methodFunction: unknown = Reflect.get(target, method);
  assert.ok(typeof methodFunction === "function", `no ${method}`);
  return Reflect.apply(methodFunction, target, args);
}

function itemsOn(data: unknown, dimensions: unknown[], count: number): unknown[][] {
  return Array.from({ length: count }, (_unused, item) => dimensions.map((dimension) => callMethod(data, "get", dimension, item)));
}

function valuesOn(data: unknown, coordinate: Coordinate, count: number): unknown[][] {
  const dimensions = callMethod(data, "mapDimensionsAll", coordinate);
  assert.ok(Array.isArray(dimensions));
  return itemsOn(data, dimensions, count);
}

function stackTops(data: unknown, count: number): unknown[] | null {
  const dimension = callMethod(data, "getCalculationInfo", "stackResultDimension");
  if (typeof dimension !== "string") return null;
  return itemsOn(data, [dimension], count).map(([top]) => top);
}

function referredModels(series: unknown, mainType: string): unknown[] {
  const referring = callMethod(series, "getReferringComponents", mainType, { useDefault: true });
  assert.ok(typeof referring === "object" && referring !== null);
  const models: unknown = Reflect.get(referring, "models");
  return Array.isArray(models) ? models : [];
}

function yAxisIndexOf(series: unknown): unknown {
  const models = referredModels(series, "yAxis");
  if (!Array.isArray(models) || models.length === 0) return null;
  const [axis]: unknown[] = models;
  assert.ok(typeof axis === "object" && axis !== null);
  return Reflect.get(axis, "componentIndex");
}

/** The sheet columns a series measures: y on a cartesian chart, value on a pie or heatmap (whose
 *  y is a category). Stacking adds dimensions of ECharts' own, which name no column. */
function valueColumns(data: unknown, type: unknown): unknown[] {
  const coordinate = type === "pie" || type === "heatmap" || type === "map" ? "value" : "y";
  const dimensions = callMethod(data, "mapDimensionsAll", coordinate);
  assert.ok(Array.isArray(dimensions));
  return dimensions.filter((dimension) => typeof dimension !== "string" || !dimension.startsWith("__"));
}

function drawnSeries(chart: echarts.ECharts): DrawnSeries[] {
  const seriesModels = callMethod(callMethod(chart, "getModel"), "getSeries");
  assert.ok(Array.isArray(seriesModels));
  return seriesModels.map((series: unknown) => {
    const data = callMethod(series, "getData");
    const count = itemCount(data);
    const values = { x: valuesOn(data, "x", count), y: valuesOn(data, "y", count), value: valuesOn(data, "value", count) };
    const type = Reflect.get(Object(series), "subType");
    const shape = { type, columns: valueColumns(data, type), stack: callMethod(series, "get", "stack") };
    const calendars = referredModels(series, "calendar").length;
    return { count, values, stackTops: stackTops(data, count), yAxisIndex: yAxisIndexOf(series), calendars, shape };
  });
}

function itemCount(data: unknown): number {
  const count = callMethod(data, "count");
  assert.ok(typeof count === "number");
  return count;
}

function drawRecipe(recipe: ChartRecipe, rows: ChartSourceRows | null = sampleRows(recipe)): Drawn {
  const option = withFormatters(rows ? withSourceRows(recipe.option, rows) : recipe.option);
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: CHART_WIDTH_PX, height: CHART_HEIGHT_PX });
  try {
    const { result, warnings } = captureWarnings(() => {
      chart.setOption(option);
      return chart.renderToSVGString();
    });
    assert.ok(result.length > 0);
    return { warnings, series: drawnSeries(chart) };
  } finally {
    chart.dispose();
  }
}

describe("presentChart recipes", () => {
  // The View and executeChart load a bundled map before drawing a chart on it.
  before(() => loadMaps([...BUNDLED_MAPS]));

  for (const recipe of CHART_RECIPES) {
    it(`draws: ${recipe.use}`, () => {
      const drawn = drawRecipe(recipe);
      assert.deepEqual(drawn.warnings, []);
      const rows = sampleRows(recipe);
      assert.equal(formatProblem(recipe.option), null, "presentChart would refuse its formats");
      assert.equal(trialDrawProblem(withFormatters(rows ? withSourceRows(recipe.option, rows) : recipe.option)), null, "presentChart would refuse it");
      assert.ok(drawn.series.length > 0, "no series");
      drawn.series.forEach(({ count }, index) => assert.ok(count > 0, `series ${index} is empty`));
      assert.deepEqual(
        drawn.series.map(({ shape }) => shape.type),
        recipeSeries(recipe).map((series) => series.type),
      );
    });
  }

  it("boxplot reads one box per row, in the order min, Q1, median, Q3, max", () => {
    const recipe = recipeNamed("boxplot");
    const boxes = drawRecipe(recipe).series[0]?.values.y ?? [];
    assert.equal(boxes.length, 2);
    assert.deepEqual(boxes[0], [1, 2, 3, 4, 10]);
  });

  it("map gives each region named in the rows its value, and the others none", () => {
    const values = withDrawnModel(recipeNamed("map"), sampleRows(recipeNamed("map")) ?? [], (model) => {
      const seriesModels = callMethod(model, "getSeries");
      assert.ok(Array.isArray(seriesModels));
      const data = callMethod(seriesModels[0], "getData");
      const dimension = callMethod(data, "mapDimension", "value");
      return Array.from({ length: itemCount(data) }, (_, index) => [callMethod(data, "getName", index), callMethod(data, "get", dimension, index)]).filter(
        ([, value]) => typeof value === "number" && !Number.isNaN(value),
      );
    });
    assert.deepEqual(values, [
      ["Tokyo", 90],
      ["Osaka", 60],
    ]);
  });

  it("candlestick reads open, close, low, high", () => {
    const recipe = recipeNamed("candlestick");
    assert.deepEqual(drawRecipe(recipe).series[0]?.values.y[0], [10, 12, 9, 13]);
  });

  it("waterfall stacks each step on the total before it, decreases included", () => {
    const recipe = recipeNamed("waterfall");
    const lastSeries = drawRecipe(recipe).series.at(-1);
    assert.deepEqual(lastSeries?.stackTops, [100, 140, 140, 110]);
  });

  it("heatmap colours each cell by the Value column", () => {
    const recipe = recipeNamed("heatmap");
    assert.deepEqual(drawRecipe(recipe).series[0]?.values.value, [[0.8], [0.8], [1]]);
  });

  it("two value axes and Pareto put the line on the second axis", () => {
    const recipes = CHART_RECIPES.filter((candidate) => candidate.use.startsWith("two value axes") || candidate.use.startsWith("Pareto"));
    assert.equal(recipes.length, 2);
    recipes.forEach((recipe) => {
      assert.deepEqual(
        drawRecipe(recipe).series.map(({ yAxisIndex }) => yAxisIndex),
        [0, 1],
        recipe.use,
      );
    });
  });

  // A series drawing the wrong column, or left out of a stack, still draws; this pins what each
  // sourced recipe means.
  for (const recipe of CHART_RECIPES.filter((candidate) => candidate.header)) {
    it(`draws each series from the intended column: ${recipe.use}`, () => {
      const header = recipe.header?.join("|") ?? "";
      assert.deepEqual(
        drawRecipe(recipe).series.map(({ shape }) => shape),
        EXPECTED_SHAPES[header],
      );
    });
  }

  // An inline recipe's numbers are an example the agent replaces; what must hold whatever the
  // numbers are is checked here.
  for (const recipe of CHART_RECIPES.filter((candidate) => !candidate.header)) {
    it(`names its series type in its use: ${recipe.use}`, () => {
      recipeSeries(recipe).forEach((series) => assert.ok(typeof series.type === "string" && recipe.use.includes(series.type), String(series.type)));
    });
  }

  it("calendar heatmap is drawn on the calendar", () => {
    const drawn = drawRecipe(recipeNamed("calendar heatmap"));
    assert.equal(drawn.series[0]?.calendars, 1);
  });

  it("radar gives each entry one value per indicator", () => {
    const { radar } = recipeNamed("radar").option;
    const indicators = isRecordValue(radar) && Array.isArray(radar.indicator) ? radar.indicator.length : 0;
    assert.ok(indicators > 0);
    recipeData(recipeNamed("radar")).forEach((entry) => assert.equal(isRecordValue(entry) && Array.isArray(entry.value) ? entry.value.length : -1, indicators));
  });

  it("parallel gives each row one value per axis", () => {
    const { parallelAxis } = recipeNamed("parallel coordinates").option;
    assert.ok(Array.isArray(parallelAxis));
    recipeData(recipeNamed("parallel coordinates")).forEach((row) => assert.equal(Array.isArray(row) ? row.length : -1, parallelAxis.length));
  });

  it("sankey links only nodes it declares", () => {
    const [sankey] = recipeSeries(recipeNamed("sankey"));
    const names = recipeData(recipeNamed("sankey")).map((node) => (isRecordValue(node) ? node.name : undefined));
    const links = sankey && Array.isArray(sankey.links) ? sankey.links : [];
    assert.ok(links.length > 0);
    links.forEach((link) => {
      assert.ok(isRecordValue(link));
      assert.ok(names.includes(link.source) && names.includes(link.target), JSON.stringify(link));
    });
  });

  it("the shaded span starts and ends on categories of the sample", () => {
    const recipe = recipeNamed("average line");
    const [series] = recipeSeries(recipe);
    const area = series && isRecordValue(series.markArea) && Array.isArray(series.markArea.data) ? series.markArea.data : [];
    const months = (sampleRows(recipe) ?? []).slice(1).map(([month]) => month);
    const ends = area.flat().map((end) => (isRecordValue(end) ? end.xAxis : undefined));
    assert.ok(ends.length === 2 && ends.every((end) => months.some((month) => month === end)), JSON.stringify(ends));
  });

  it("fitted curve passes through points that lie on it, sorted along x", () => {
    const [, line] = drawRecipe(recipeNamed("fitted curve")).series;
    const spends = [10, 20, 30, 40];
    assert.deepEqual(
      line?.values.x,
      spends.map((spend) => [spend]),
    );
    line?.values.y.forEach(([sales], item) => {
      const spend = spends[item] ?? Number.NaN;
      assert.ok(typeof sales === "number" && Math.abs(sales - onExponential(spend)) < FIT_TOLERANCE, `${spend}: ${String(sales)}`);
    });
  });

  it("fitted curve skips a row whose cell is blank or text", () => {
    const rows: ChartSourceRows = [
      ["Spend", "Sales"],
      [10, onExponential(10)],
      [null, 5],
      [20, "n/a"],
      [30, onExponential(30)],
    ];
    assert.equal(drawRecipe(recipeNamed("fitted curve"), rows).series[1]?.count, 2);
  });

  it("histogram straight from a column counts each value once, in its bin", () => {
    const recipe = recipeNamed("histogram straight");
    const rows: ChartSourceRows = [...(sampleRows(recipe) ?? []), [null], ["n/a"]];
    // The sample's scores 3 7 | 12 18 19 | 25 26 27 | - | 41, counted by hand.
    assert.deepEqual(histogramBins(recipe, rows), [
      { low: 0, high: 10, count: 2 },
      { low: 10, high: 20, count: 3 },
      { low: 20, high: 30, count: 3 },
      { low: 30, high: 40, count: 0 },
      { low: 40, high: 50, count: 1 },
    ]);
    assert.deepEqual(xAxisCategories(recipe, rows), ["0 - 10", "10 - 20", "20 - 30", "30 - 40", "40 - 50"]);
  });

  it("waterfall draws its base transparent", () => {
    const recipe = recipeNamed("waterfall");
    const [base] = recipeSeries(recipe);
    assert.deepEqual(base, { type: "bar", stack: "w", itemStyle: { color: "transparent" } });
  });

  // A column encoded where it does not belong still draws, so compare what each coordinate
  // received with the sample's numbers.
  // A map's items are its regions, not the rows, so it is checked by region below.
  for (const recipe of CHART_RECIPES.filter(
    (candidate) => candidate.header && encodedSeries(candidate.option).length > 0 && !candidate.use.startsWith("map"),
  )) {
    it(`draws the encoded columns on their coordinates: ${recipe.use}`, () => {
      const rows = sampleRows(recipe);
      assert.ok(rows);
      const [header, ...body] = rows;
      const drawn = drawRecipe(recipe);
      encodedSeries(recipe.option).forEach(({ index, encode }) => {
        COORDINATES.forEach((coordinate) => {
          const names = encode[coordinate];
          if (names === undefined) return;
          const columns = (Array.isArray(names) ? names : [names]).map((name) => header?.indexOf(name) ?? -1);
          const expected = body.map((row) => columns.map((column) => row[column]));
          const actual = drawn.series[index]?.values[coordinate] ?? [];
          actual.flat().forEach((value) => assert.ok(typeof value === "number" && !Number.isNaN(value), `${coordinate} received ${String(value)}`));
          expected.forEach((cells, item) =>
            cells.forEach((cell, position) => {
              if (typeof cell === "number") assert.equal(actual[item]?.[position], cell, `${coordinate} of item ${item}`);
            }),
          );
        });
      });
    });
  }
});

interface HistogramBin {
  low: number;
  high: number;
  count: number;
}

/** The transform's output read back from ECharts: each bin's edges (V0, V1) and count. */
function histogramBins(recipe: ChartRecipe, rows: ChartSourceRows): HistogramBin[] {
  return readTransformed(recipe, rows, ["V0", "V1", "VCount"]).map(([low, high, count]) => {
    assert.ok(typeof low === "number" && typeof high === "number" && typeof count === "number");
    return { low, high, count };
  });
}

/** The first series' values on `dimensions`, as ECharts computed them. */
function readTransformed(recipe: ChartRecipe, rows: ChartSourceRows, dimensions: string[]): unknown[][] {
  return withDrawnModel(recipe, rows, (model) => {
    const seriesModels = callMethod(model, "getSeries");
    assert.ok(Array.isArray(seriesModels));
    const data = callMethod(seriesModels[0], "getData");
    return itemsOn(data, dimensions, itemCount(data));
  });
}

/** The labels the x axis shows. */
function xAxisCategories(recipe: ChartRecipe, rows: ChartSourceRows): unknown {
  return withDrawnModel(recipe, rows, (model) => callMethod(callMethod(model, "getComponent", "xAxis"), "getCategories"));
}

function withDrawnModel<T>(recipe: ChartRecipe, rows: ChartSourceRows, read: (model: unknown) => T): T {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: CHART_WIDTH_PX, height: CHART_HEIGHT_PX });
  try {
    chart.setOption(withSourceRows(recipe.option, rows));
    return read(callMethod(chart, "getModel"));
  } finally {
    chart.dispose();
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recipeNamed(prefix: string): ChartRecipe {
  const recipe = CHART_RECIPES.find((candidate) => candidate.use.startsWith(prefix));
  assert.ok(recipe, prefix);
  return recipe;
}

function recipeSeries(recipe: ChartRecipe): Record<string, unknown>[] {
  const { series } = recipe.option;
  return Array.isArray(series) ? series.filter(isRecordValue) : [];
}

/** The first series' inline data. */
function recipeData(recipe: ChartRecipe): unknown[] {
  const [first] = recipeSeries(recipe);
  return first && Array.isArray(first.data) ? first.data : [];
}

interface EncodedSeries {
  index: number;
  encode: Partial<Record<Coordinate, unknown>>;
}

function isEncodeRecord(value: unknown): value is Partial<Record<Coordinate, unknown>> {
  return typeof value === "object" && value !== null;
}

/** A series reading a transform's output (`datasetIndex` past the source) names that output's
 *  columns, not the sheet's. */
function readsSource(entry: object): boolean {
  return !("datasetIndex" in entry) || entry.datasetIndex === 0;
}

/** The series of a recipe that read the source and carry an encode, with their position. */
function encodedSeries(option: Record<string, unknown>): EncodedSeries[] {
  const { series } = option;
  if (!Array.isArray(series)) return [];
  return series.flatMap((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null || !("encode" in entry) || !readsSource(entry)) return [];
    const { encode } = entry;
    return isEncodeRecord(encode) ? [{ index, encode }] : [];
  });
}

/** Every column name a recipe's encode names, from any series reading the source. */
function encodedNames(option: Record<string, unknown>): string[] {
  const { series } = option;
  if (!Array.isArray(series)) return [];
  return series.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("encode" in entry) || !readsSource(entry)) return [];
    const { encode } = entry;
    if (typeof encode !== "object" || encode === null) return [];
    return Object.values(encode)
      .flat()
      .filter((name): name is string => typeof name === "string");
  });
}

describe("presentChart recipe columns", () => {
  for (const recipe of CHART_RECIPES.filter((candidate) => candidate.header)) {
    it(`encodes only columns of its header: ${recipe.use}`, () => {
      encodedNames(recipe.option).forEach((name) => assert.ok(recipe.header?.includes(name), name));
    });
  }
});

describe("presentChart description", () => {
  it("keeps the top-level description inside Claude Code's limit", () => {
    assert.ok(TOOL_DEFINITION.description.length <= CLAUDE_CODE_DESCRIPTION_LIMIT, `${TOOL_DEFINITION.description.length} characters`);
  });

  it("puts every recipe in the option's description", () => {
    const text = JSON.stringify(TOOL_DEFINITION.parameters);
    CHART_RECIPES.forEach((recipe) => assert.ok(text.includes(JSON.stringify(JSON.stringify(recipe.option)).slice(1, -1)), recipe.use));
  });
});
