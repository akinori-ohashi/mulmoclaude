// A source can ask for its rows reshaped (a cross table into cells, a long table into one column
// per group), and a chart can read several ranges. These pin the shapes, the checks on the
// arguments, and that ECharts draws what comes out.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupIntoColumns, matrixToCells } from "../../../packages/plugins/chart-plugin/src/core/sourceShapes";
import { chartOption, chartSources, isChartSource, shapeRows, withSourceRowsList } from "../../../packages/plugins/chart-plugin/src/core/source";
import { executeChart, isValidChartDocument } from "../../../packages/plugins/chart-plugin/src/core/plugin";
import { trialDrawProblem } from "../../../packages/plugins/chart-plugin/src/core/drawProblem";
import { CHART_RECIPES } from "../../../packages/plugins/chart-plugin/src/core/recipes";
import type { ChartSource, ChartSourceRows } from "../../../packages/plugins/chart-plugin/src/core/types";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";
import { memoryArtifacts } from "./memoryArtifacts";

const BOOK = "artifacts/spreadsheets/2026/10/abc.json";

const CROSS_TABLE: ChartSourceRows = [
  ["", "Sales", "Temp"],
  ["Sales", 1, 0.8],
  ["Temp", 0.8, null],
];

const LONG_TABLE: ChartSourceRows = [
  ["Date", "Region", "Sales"],
  ["Jan", "East", 10],
  ["Jan", "West", 20],
  ["Feb", "East", 15],
  ["Feb", "East", 5],
  ["Mar", "West", 30],
];

describe("matrixToCells", () => {
  it("writes one [X, Y, Value] row per cell, X from the top and Y down the side", () => {
    assert.deepEqual(matrixToCells(CROSS_TABLE), [
      ["X", "Y", "Value"],
      ["Sales", "Sales", 1],
      ["Temp", "Sales", 0.8],
      ["Sales", "Temp", 0.8],
      ["Temp", "Temp", null],
    ]);
  });

  it("fills a short row with nothing, and gives a header-only range no cells", () => {
    assert.deepEqual(
      matrixToCells([
        ["", "A", "B"],
        ["r", 1],
      ]).slice(1),
      [
        ["A", "r", 1],
        ["B", "r", null],
      ],
    );
    assert.deepEqual(matrixToCells([["", "A"]]), [["X", "Y", "Value"]]);
  });
});

describe("groupIntoColumns", () => {
  it("makes one column per group, in the order they appear, adding up rows that meet", () => {
    assert.deepEqual(groupIntoColumns(LONG_TABLE, { column: "Region" }), [
      ["Date", "East", "West"],
      ["Jan", 10, 20],
      ["Feb", 20, null],
      ["Mar", null, 30],
    ]);
  });

  it("takes the x and value columns it is told", () => {
    const rows: ChartSourceRows = [
      ["Sales", "Region", "Units", "Date"],
      [10, "East", 1, "Jan"],
      [20, "West", 2, "Jan"],
    ];
    assert.deepEqual(groupIntoColumns(rows, { column: "Region", x: "Date", value: "Units" }), [
      ["Date", "East", "West"],
      ["Jan", 1, 2],
    ]);
  });

  it("keeps the last of several texts meeting in one cell, and names numeric groups as text", () => {
    const rows: ChartSourceRows = [
      ["Year", "Team", "Note"],
      [2025, 1, "a"],
      [2025, 1, "b"],
    ];
    assert.deepEqual(groupIntoColumns(rows, { column: "Team" }), [
      ["Year", "1"],
      [2025, "b"],
    ]);
  });

  it("names a missing column and the header it looked in", () => {
    assert.throws(() => groupIntoColumns(LONG_TABLE, { column: "Area" }), /no column "Area" in the range's header \(Date, Region, Sales\)/);
    assert.throws(() => groupIntoColumns(LONG_TABLE, { column: "Region", value: "Profit" }), /no column "Profit"/);
  });

  it("says when the range has too few columns", () => {
    assert.throws(() => groupIntoColumns([["Region"], ["East"]], { column: "Region" }), /no column left for x/);
    assert.throws(
      () =>
        groupIntoColumns(
          [
            ["Date", "Region"],
            ["Jan", "East"],
          ],
          { column: "Region" },
        ),
      /no column left for the value/,
    );
  });
});

describe("source shapes in the arguments", () => {
  const source = (extra: Record<string, unknown>) => ({ spreadsheet: BOOK, range: "A1:C9", ...extra });

  it("accepts a table, a matrix, and a grouping", () => {
    [{}, { layout: "table" }, { layout: "matrix" }, { groupBy: { column: "Region" } }, { groupBy: { column: "R", x: "D", value: "S" } }].forEach((extra) =>
      assert.equal(isChartSource(source(extra)), true, JSON.stringify(extra)),
    );
  });

  it("rejects another layout, a malformed grouping, and a grouped matrix", () => {
    [
      { layout: "pivot" },
      { groupBy: "Region" },
      { groupBy: {} },
      { groupBy: { column: " " } },
      { groupBy: { column: "R", x: 3 } },
      { layout: "matrix", groupBy: { column: "R" } },
    ].forEach((extra) => assert.equal(isChartSource(source(extra)), false, JSON.stringify(extra)));
  });

  it("accepts several ranges, but not none, not a bad one, and not alongside source", () => {
    const chart = (extra: Record<string, unknown>) => ({ charts: [{ option: {}, ...extra }] });
    assert.equal(isValidChartDocument(chart({ sources: [source({}), source({ layout: "matrix" })] })), true);
    assert.equal(isValidChartDocument(chart({ sources: [] })), false);
    assert.equal(isValidChartDocument(chart({ sources: [source({}), { range: "A1" }] })), false);
    assert.equal(isValidChartDocument(chart({ sources: source({}) })), false);
    assert.equal(isValidChartDocument(chart({ source: source({}), sources: [source({})] })), false);
  });
});

describe("shapeRows and chartOption", () => {
  const plain: ChartSource = { spreadsheet: BOOK, range: "A1:C3" };

  it("leaves a table, and a range not read yet, as they are", () => {
    assert.equal(shapeRows(plain, LONG_TABLE), LONG_TABLE);
    assert.deepEqual(shapeRows({ ...plain, groupBy: { column: "Region" } }, []), []);
  });

  it("fills one dataset per range in order, reshaped, and keeps the datasets after them", () => {
    const chart = {
      option: { dataset: [{}, {}, { transform: { type: "filter" } }], series: [{ type: "line", data: [1] }] },
      sources: [
        { ...plain, groupBy: { column: "Region" } },
        { ...plain, layout: "matrix" as const },
      ],
    };
    assert.deepEqual(chartSources(chart), chart.sources);
    const option = chartOption(chart, [LONG_TABLE, CROSS_TABLE], true);
    assert.deepEqual(option.dataset, [
      { source: groupIntoColumns(LONG_TABLE, { column: "Region" }), sourceHeader: true },
      { source: matrixToCells(CROSS_TABLE), sourceHeader: true },
      { transform: { type: "filter" } },
    ]);
    assert.deepEqual(option.series, [{ type: "line" }]);
  });

  it("turns a single dataset object into a list when there are several ranges", () => {
    assert.deepEqual(withSourceRowsList({ dataset: { dimensions: ["a"] } }, [[["a"]], [["b"]]]).dataset, [
      { dimensions: ["a"], source: [["a"]], sourceHeader: true },
      { source: [["b"]], sourceHeader: true },
    ]);
  });

  it("gives a chart without ranges no sources", () => {
    assert.deepEqual(chartSources({ option: {} }), []);
  });
});

const recipeOption = (prefix: string): Record<string, unknown> => {
  const recipe = CHART_RECIPES.find((candidate) => candidate.use.startsWith(prefix));
  assert.ok(recipe, prefix);
  return recipe.option;
};

function drawnSeriesNames(option: Record<string, unknown>): unknown[] {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 640, height: 400 });
  try {
    chart.setOption(option);
    // The names ECharts gave the series from the dataset header live on its (private) model.
    const model: unknown = Reflect.apply(Reflect.get(chart, "getModel"), chart, []);
    const series: unknown = Reflect.apply(Reflect.get(Object(model), "getSeries"), model, []);
    return Array.isArray(series) ? series.map((entry: unknown) => Reflect.get(Object(entry), "name")) : [];
  } finally {
    chart.dispose();
  }
}

describe("reshaped ranges drawn by ECharts", () => {
  it("draws the heatmap recipe from a cross table", () => {
    const source: ChartSource = { spreadsheet: BOOK, range: "A1:C3", layout: "matrix" };
    assert.equal(trialDrawProblem(chartOption({ option: recipeOption("heatmap"), source }, [CROSS_TABLE], true)), null);
  });

  it("draws one series per group of a long table, named after it", () => {
    const source: ChartSource = { spreadsheet: BOOK, range: "A1:C6", groupBy: { column: "Region" } };
    const option = { xAxis: { type: "category" }, yAxis: {}, series: [{ type: "line" }, { type: "line" }] };
    assert.deepEqual(drawnSeriesNames(chartOption({ option, source }, [LONG_TABLE], true)), ["East", "West"]);
  });
});

describe("executeChart with reshaped and several ranges", () => {
  const option = { xAxis: { type: "category" }, yAxis: {}, series: [{ type: "line" }, { type: "line", datasetIndex: 1 }] };

  it("reads each range in order and saves the chart", async () => {
    const seen: string[] = [];
    const sources = [
      { spreadsheet: BOOK, range: "Low!A1:B3" },
      { spreadsheet: BOOK, range: "High!A1:B3" },
    ];
    const reader = {
      read: async (source: ChartSource): Promise<ChartSourceRows> => {
        seen.push(source.range);
        return [
          ["Month", "Value"],
          ["Jan", 1],
        ];
      },
    };
    const artifacts = memoryArtifacts();
    const result = await executeChart({ files: { artifacts }, sources: reader }, { document: { charts: [{ option, sources }] } });
    assert.ok(result.data, result.message);
    assert.deepEqual(seen, ["Low!A1:B3", "High!A1:B3"]);
  });

  it("refuses a grouping whose column is not in the range, naming it", async () => {
    const source = { spreadsheet: BOOK, range: "A1:C6", groupBy: { column: "Area" } };
    const artifacts = memoryArtifacts();
    const result = await executeChart({ files: { artifacts }, sources: { read: async () => LONG_TABLE } }, { document: { charts: [{ option, source }] } });
    assert.equal(result.data, undefined);
    assert.match(result.message ?? "", /Chart 1 could not be drawn: groupBy: no column "Area"/);
    assert.equal(artifacts.written.length, 0);
  });

  it("names the range that could not be read", async () => {
    const sources = [
      { spreadsheet: BOOK, range: "Low!A1:B3" },
      { spreadsheet: BOOK, range: "Gone!A1:B3" },
    ];
    const reader = {
      read: async (source: ChartSource): Promise<ChartSourceRows> => {
        if (source.range.startsWith("Gone")) throw new Error("no sheet named Gone");
        return [["Month"]];
      },
    };
    const result = await executeChart({ files: { artifacts: memoryArtifacts() }, sources: reader }, { document: { charts: [{ option, sources }] } });
    assert.match(result.message ?? "", /Cannot read Gone!A1:B3 of .*: no sheet named Gone/);
  });
});
