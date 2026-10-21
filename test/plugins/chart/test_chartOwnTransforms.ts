// mulmo:clustering and mulmo:boxplotColumns: a clustering that is the same on every redraw, and a
// box per sheet column. The maths is checked against answers that do not come from it: groups
// placed far apart, and ECharts' own prepareBoxplotData over generated columns.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import prepareBoxplotData from "echarts/extension/dataTool/prepareBoxplotData";
import { kMeans, type Point } from "../../../packages/plugins/chart-plugin/src/core/kMeans";
import { boxOf, cellNumber } from "../../../packages/plugins/chart-plugin/src/core/columnBoxes";
import { trialDrawProblem } from "../../../packages/plugins/chart-plugin/src/core/drawProblem";
import { withSourceRows } from "../../../packages/plugins/chart-plugin/src/core/source";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";
import { CHART_RECIPES } from "../../../packages/plugins/chart-plugin/src/core/recipes";
import type { ChartSourceRows } from "../../../packages/plugins/chart-plugin/src/core/types";

const TEST_SEED = 20261020;
const GENERATED_CASES = 500;
const BOX_TOLERANCE = 1e-9;

/** The tests' own generator, printed seed, so a failing case can be drawn again. */
function testRandom(seed: number): () => number {
  const state = { value: seed >>> 0 };
  return () => {
    state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
    return state.value / 4294967296;
  };
}

/** Rows grouped by label, as sets of row indexes, so cluster numbering does not matter. */
const partition = (labels: number[]): string[] =>
  [...new Set(labels)].map((label) => labels.flatMap((value, index) => (value === label ? [index] : [])).join(",")).sort();

describe("kMeans", () => {
  it(`splits three far-apart pairs correctly in ${GENERATED_CASES} generated layouts (seed ${TEST_SEED})`, () => {
    const random = testRandom(TEST_SEED);
    Array.from({ length: GENERATED_CASES }).forEach((_, attempt) => {
      const centres: Point[] = [
        [random() * 10, random() * 10],
        [100 + random() * 10, random() * 10],
        [random() * 10, 100 + random() * 10],
      ];
      const order = [0, 1, 2, 0, 1, 2].sort(() => random() - 0.5);
      const points = order.map((group) => (centres[group] ?? [0, 0]).map((value) => value + random()));
      const expected = partition(order);
      assert.deepEqual(partition(kMeans(points, 3)), expected, `attempt ${attempt}: ${JSON.stringify(points)}`);
    });
  });

  it(`finds five groups of very different sizes in ${GENERATED_CASES} generated layouts, which one start often misses`, () => {
    const random = testRandom(TEST_SEED + 2);
    const sizes = [40, 3, 40, 3, 40];
    const order = sizes.flatMap((size, group) => Array.from({ length: size }, () => group));
    Array.from({ length: GENERATED_CASES }).forEach((_, attempt) => {
      const centres: Point[] = sizes.map((_size, group) => [group * 30 + random() * 5, random() * 5]);
      const points = order.map((group) => (centres[group] ?? [0, 0]).map((value) => value + (random() - 0.5) * 8));
      assert.deepEqual(partition(kMeans(points, sizes.length)), partition(order), `attempt ${attempt}`);
    });
  });

  it("gives the same labels on every call", () => {
    const random = testRandom(TEST_SEED + 1);
    const points = Array.from({ length: 60 }, () => [random() * 100, random() * 100]);
    const first = kMeans(points, 4);
    Array.from({ length: 20 }).forEach(() => assert.deepEqual(kMeans(points, 4), first));
  });

  it("numbers clusters in the order the rows first meet them", () => {
    const labels = kMeans([[100], [0], [101], [1], [50]], 3);
    assert.deepEqual(labels, [0, 1, 0, 1, 2]);
  });

  it("handles no points, one cluster, more clusters than points, and identical points", () => {
    assert.deepEqual(kMeans([], 3), []);
    assert.deepEqual(kMeans([[1], [5], [9]], 1), [0, 0, 0]);
    assert.deepEqual(kMeans([[1], [5]], 5), [0, 1]);
    assert.deepEqual(
      kMeans(
        [
          [2, 2],
          [2, 2],
          [2, 2],
        ],
        2,
      ),
      [0, 0, 0],
    );
  });
});

describe("boxOf", () => {
  it(`matches ECharts' prepareBoxplotData on ${GENERATED_CASES} generated columns (seed ${TEST_SEED})`, () => {
    const random = testRandom(TEST_SEED);
    const bounds: (number | "none")[] = [1.5, 0, 3, "none"];
    Array.from({ length: GENERATED_CASES }).forEach((_, attempt) => {
      const values = Array.from({ length: 1 + Math.floor(random() * 30) }, () => Math.round((random() - 0.3) * 1000) / 10);
      const boundIQR = bounds[attempt % bounds.length] ?? 1.5;
      const expected = prepareBoxplotData([values], { boundIQR });
      const actual = boxOf("c", values, boundIQR);
      assert.ok(actual);
      const [expectedBox] = expected.boxData;
      actual.box.forEach((value, index) =>
        assert.ok(Math.abs(value - Number(expectedBox?.[index])) < BOX_TOLERANCE, `attempt ${attempt} (${boundIQR}): ${JSON.stringify(values)}`),
      );
      assert.deepEqual(
        actual.outliers,
        expected.outliers.map(([, value]) => value),
        `attempt ${attempt} outliers`,
      );
    });
  });

  it("is null for a column with no numbers", () => {
    assert.equal(boxOf("c", []), null);
  });
});

describe("cellNumber", () => {
  it("reads finite numbers and numeric text, and nothing else", () => {
    assert.equal(cellNumber(3.5), 3.5);
    assert.equal(cellNumber("42"), 42);
    assert.equal(cellNumber(" 7 "), 7);
    [null, undefined, "", "  ", "n/a", Number.NaN, Number.POSITIVE_INFINITY, true, {}].forEach((value) => assert.equal(cellNumber(value), null, String(value)));
  });
});

// ECharts' model is private, hence the reads through Reflect.
function callMethod(target: unknown, method: string, ...args: unknown[]): unknown {
  assert.ok(typeof target === "object" && target !== null, `no object for ${method}`);
  const methodFunction: unknown = Reflect.get(target, method);
  assert.ok(typeof methodFunction === "function", `no ${method}`);
  return Reflect.apply(methodFunction, target, args);
}

interface DrawnRows {
  dimensions: unknown;
  rows: unknown[][];
  colours: unknown[];
}

function drawnSeries(option: Record<string, unknown>): DrawnRows[] {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 640, height: 400 });
  try {
    chart.setOption(option);
    const series = callMethod(callMethod(chart, "getModel"), "getSeries");
    assert.ok(Array.isArray(series));
    return series.map((model: unknown) => {
      const data = callMethod(model, "getData");
      const count = Number(callMethod(data, "count"));
      const rows = Array.from({ length: count }, (_, index) => {
        const values = callMethod(data, "getValues", index);
        assert.ok(Array.isArray(values));
        return values;
      });
      const colours = rows.map((_, index) => Reflect.get(Object(callMethod(data, "getItemVisual", index, "style")), "fill"));
      return { dimensions: Reflect.get(Object(data), "dimensions"), rows, colours };
    });
  } finally {
    chart.dispose();
  }
}

const recipeStarting = (prefix: string): Record<string, unknown> => {
  const recipe = CHART_RECIPES.find((candidate) => candidate.use.startsWith(prefix));
  assert.ok(recipe, prefix);
  return recipe.option;
};

describe("mulmo:clustering through ECharts", () => {
  const rows: ChartSourceRows = [
    ["Name", "Income", "Spend"],
    ["a", 10, 11],
    ["b", 90, 88],
    ["skipped", "n/a", 5],
    ["c", 12, 9],
    ["d", 91, 92],
  ];

  it("adds a Cluster column, skips a row with text, and colours the clusters apart", () => {
    const [scatter] = drawnSeries(withSourceRows(recipeStarting("clusters"), rows));
    assert.ok(scatter);
    assert.deepEqual(
      scatter.rows.map((row) => [row[0], row[3]]),
      [
        ["a", 0],
        ["b", 1],
        ["c", 0],
        ["d", 1],
      ],
    );
    const [first, second, third] = scatter.colours;
    assert.equal(first, third);
    assert.notEqual(first, second);
  });

  it("refuses a missing or wrong config, naming it", () => {
    const transform = (config: unknown) => ({
      dataset: [{ source: rows }, { transform: { type: "mulmo:clustering", config } }],
      xAxis: { type: "value" },
      yAxis: {},
      series: [{ type: "scatter", datasetIndex: 1 }],
    });
    assert.match(trialDrawProblem(transform({})) ?? "", /clusterCount/);
    assert.match(trialDrawProblem(transform({ clusterCount: 0 })) ?? "", /clusterCount/);
    assert.match(trialDrawProblem(transform({ clusterCount: 2, dimensions: ["Height"] })) ?? "", /no column "Height"/);
    assert.match(trialDrawProblem(transform({ clusterCount: 2, dimensions: [] })) ?? "", /dimensions/);
  });

  it("clusters every column holding numbers when dimensions are left out", () => {
    const option = {
      dataset: [{ source: rows, sourceHeader: true }, { transform: { type: "mulmo:clustering", config: { clusterCount: 2 } } }],
      xAxis: { type: "value" },
      yAxis: {},
      series: [{ type: "scatter", datasetIndex: 1, encode: { x: "Income", y: "Spend" } }],
    };
    const [scatter] = drawnSeries(option);
    assert.deepEqual(
      scatter?.rows.map((row) => row[3]),
      [0, 1, 0, 1],
    );
  });
});

describe("mulmo:boxplotColumns through ECharts", () => {
  const rows: ChartSourceRows = [
    ["Week", "Store A", "Store B"],
    ["W1", 10, 30],
    ["W2", 12, 31],
    ["W3", 11, 29],
    ["W4", 13, 90],
    ["W5", null, "closed"],
  ];

  it("draws one box per named column and its outliers", () => {
    const [boxes, outliers] = drawnSeries(withSourceRows(recipeStarting("boxplot of each column"), rows));
    const expectedB = boxOf("Store B", [30, 31, 29, 90]);
    assert.deepEqual(boxes?.rows[1]?.slice(1), expectedB?.box);
    assert.equal(boxes?.rows.length, 2);
    assert.deepEqual(outliers?.rows, [[1, 90]]);
  });

  it("boxes every column holding numbers when dimensions are left out, not the labels", () => {
    const option = {
      dataset: [{ source: rows, sourceHeader: true }, { transform: { type: "mulmo:boxplotColumns" } }],
      xAxis: { type: "category" },
      yAxis: {},
      series: [{ type: "boxplot", datasetIndex: 1 }],
    };
    assert.equal(drawnSeries(option)[0]?.rows.length, 2);
  });

  it("refuses a wrong boundIQR", () => {
    const option = {
      dataset: [{ source: rows, sourceHeader: true }, { transform: { type: "mulmo:boxplotColumns", config: { boundIQR: -1 } } }],
      xAxis: { type: "category" },
      yAxis: {},
      series: [{ type: "boxplot", datasetIndex: 1 }],
    };
    assert.match(trialDrawProblem(option) ?? "", /boundIQR/);
  });
});
