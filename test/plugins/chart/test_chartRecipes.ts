// The recipes in presentChart's description are the options an agent copies, so each one is
// drawn here the way the View draws it: through `withSourceRows` when it reads a range, then by
// ECharts itself. A recipe that throws, warns, or leaves a series empty fails.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as echarts from "echarts";
import { CHART_RECIPES, type ChartRecipe } from "../../../packages/plugins/chart-plugin/src/core/recipes";
import { TOOL_DEFINITION } from "../../../packages/plugins/chart-plugin/src/core/definition";
import { withSourceRows } from "../../../packages/plugins/chart-plugin/src/core/source";
import type { ChartSourceRows } from "../../../packages/plugins/chart-plugin/src/core/types";

// Claude Code cuts an MCP tool's top-level description here (CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH)
// and passes property descriptions whole, which is why the recipes sit on `option`.
const CLAUDE_CODE_DESCRIPTION_LIMIT = 2048;

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
  "Step|Base|Change": [
    ["Step", "Base", "Change"],
    ["Start", 0, 100],
    ["Sales", 100, 40],
    ["Costs", 110, 30],
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
  "Time|Value": [
    ["Time", "Value"],
    ["t1", 1],
    ["t2", 3],
  ],
};

function sampleRows(recipe: ChartRecipe): ChartSourceRows | null {
  if (!recipe.header) return null;
  const rows = SAMPLE_ROWS[recipe.header.join("|")];
  assert.ok(rows, `no sample rows for "${recipe.use}"`);
  assert.deepEqual(rows[0], [...recipe.header], `sample header for "${recipe.use}"`);
  return rows;
}

interface Drawn {
  warnings: string[];
  seriesCounts: number[];
  /** Each item's values on the dimensions mapped to y, in encode's order. */
  seriesYValues: (index: number) => unknown[][];
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

function drawnSeriesData(chart: echarts.ECharts): unknown[] {
  const seriesModels = callMethod(callMethod(chart, "getModel"), "getSeries");
  assert.ok(Array.isArray(seriesModels));
  return seriesModels.map((series: unknown) => callMethod(series, "getData"));
}

function itemCount(data: unknown): number {
  const count = callMethod(data, "count");
  assert.ok(typeof count === "number");
  return count;
}

function drawRecipe(recipe: ChartRecipe): Drawn {
  const rows = sampleRows(recipe);
  const option = rows ? withSourceRows(recipe.option, rows) : recipe.option;
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: CHART_WIDTH_PX, height: CHART_HEIGHT_PX });
  try {
    const { result, warnings } = captureWarnings(() => {
      chart.setOption(option);
      return chart.renderToSVGString();
    });
    assert.ok(result.length > 0);
    const seriesData = drawnSeriesData(chart);
    const yValuesByIndex = seriesData.map((data) => {
      const yDimensions = callMethod(data, "mapDimensionsAll", "y");
      assert.ok(Array.isArray(yDimensions));
      return Array.from({ length: itemCount(data) }, (_unused, item) => yDimensions.map((dimension) => callMethod(data, "get", dimension, item)));
    });
    return { warnings, seriesCounts: seriesData.map(itemCount), seriesYValues: (index) => yValuesByIndex[index] ?? [] };
  } finally {
    chart.dispose();
  }
}

describe("presentChart recipes", () => {
  for (const recipe of CHART_RECIPES) {
    it(`draws: ${recipe.use}`, () => {
      const drawn = drawRecipe(recipe);
      assert.deepEqual(drawn.warnings, []);
      assert.ok(drawn.seriesCounts.length > 0, "no series");
      drawn.seriesCounts.forEach((count, index) => assert.ok(count > 0, `series ${index} is empty`));
    });
  }

  it("boxplot reads one box per row, in the order min, Q1, median, Q3, max", () => {
    const recipe = CHART_RECIPES.find((candidate) => candidate.use.startsWith("boxplot"));
    assert.ok(recipe);
    const boxes = drawRecipe(recipe).seriesYValues(0);
    assert.equal(boxes.length, 2);
    assert.deepEqual(boxes[0], [1, 2, 3, 4, 10]);
  });

  it("candlestick reads open, close, low, high", () => {
    const recipe = CHART_RECIPES.find((candidate) => candidate.use.startsWith("candlestick"));
    assert.ok(recipe);
    assert.deepEqual(drawRecipe(recipe).seriesYValues(0)[0], [10, 12, 9, 13]);
  });
});

/** Every column name a recipe's encode names, from any series. */
function encodedNames(option: Record<string, unknown>): string[] {
  const { series } = option;
  if (!Array.isArray(series)) return [];
  return series.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("encode" in entry)) return [];
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
