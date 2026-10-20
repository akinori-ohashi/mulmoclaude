// A chart ECharts cannot draw stays blank, so the reason is shown on its card and, before the
// document is saved, returned to the agent. ECharts throws for most broken options, but drops a
// series of a type it does not know without throwing, so both are covered.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setOptionProblem, trialDrawProblem } from "../../../packages/plugins/chart-plugin/src/core/drawProblem";
import { executeChart } from "../../../packages/plugins/chart-plugin/src/core/plugin";
import type { ChartSourceRows } from "../../../packages/plugins/chart-plugin/src/core/types";
import { memoryArtifacts } from "./memoryArtifacts";

const DRAWABLE = { xAxis: { type: "category", data: ["Jan", "Feb"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] };

/** Options ECharts cannot draw, each with a phrase its reason must contain. */
const UNDRAWABLE: { name: string; option: Record<string, unknown>; reason: RegExp }[] = [
  { name: "a bar without axes", option: { series: [{ type: "bar", data: [1, 2] }] }, reason: /need xAxis and yAxis/ },
  { name: "a line with only an x axis", option: { xAxis: {}, series: [{ type: "line", data: [1, 2] }] }, reason: /need yAxis,/ },
  { name: "an unknown series type (dropped, not thrown)", option: { series: [{ type: "barr", data: [1] }] }, reason: /Unknown series type "barr"/ },
  {
    name: "a dataset it cannot read",
    option: { dataset: { source: 5 }, xAxis: { type: "category" }, yAxis: {}, series: [{ type: "bar" }] },
    reason: /sourceFormat/,
  },
  {
    name: "an unregistered transform",
    option: {
      dataset: [
        {
          source: [
            ["a", "b"],
            [1, 2],
          ],
        },
        { transform: { type: "ecStat:clustering" } },
      ],
      xAxis: {},
      yAxis: {},
      series: [{ type: "scatter", datasetIndex: 1 }],
    },
    reason: /ecStat:clustering/,
  },
  { name: "an unregistered map", option: { series: [{ type: "map", map: "atlantis", data: [] }] }, reason: /No map named "atlantis"/ },
  { name: "a geo component on an unregistered map", option: { geo: { map: "atlantis" } }, reason: /No map named "atlantis"/ },
];

describe("trialDrawProblem", () => {
  it("is null for an option ECharts draws", () => {
    assert.equal(trialDrawProblem(DRAWABLE), null);
  });

  for (const { name, option, reason } of UNDRAWABLE) {
    it(`names the reason for ${name}`, () => {
      assert.match(trialDrawProblem(option) ?? "", reason);
    });
  }
});

describe("trialDrawProblem does not ask for axes a series does not use", () => {
  const drawable: [string, Record<string, unknown>][] = [
    ["a pie", { series: [{ type: "pie", data: [{ name: "a", value: 1 }] }] }],
    [
      "a bar on polar",
      { polar: {}, angleAxis: { type: "category", data: ["a"] }, radiusAxis: {}, series: [{ type: "bar", coordinateSystem: "polar", data: [1] }] },
    ],
    [
      "a heatmap on a calendar",
      { calendar: { range: "2026-01" }, visualMap: { show: false }, series: [{ type: "heatmap", coordinateSystem: "calendar", data: [["2026-01-02", 3]] }] },
    ],
  ];
  for (const [name, option] of drawable) {
    it(name, () => assert.equal(trialDrawProblem(option), null));
  }
});

describe("setOptionProblem", () => {
  const fakeChart = (setOption: () => void, keptSeries: unknown[]) => ({ setOption, getOption: () => ({ series: keptSeries }) });
  const noop = () => {};

  it("names a series type ECharts dropped, once, even when the same type was seen before", () => {
    const option = { series: [{ type: "barr" }, { type: "barr" }, { type: "pie" }] };
    [1, 2].forEach(() => assert.equal(setOptionProblem(fakeChart(noop, [{ type: "pie" }]), option), 'Unknown series type "barr"'));
  });

  it("names a series without a type", () => {
    assert.equal(setOptionProblem(fakeChart(noop, []), { series: { data: [1] } }), 'Unknown series type "(none)"');
  });

  it("is null when every series was kept, and for an option with no series", () => {
    assert.equal(setOptionProblem(fakeChart(noop, [{ type: "pie" }]), { series: [{ type: "pie" }] }), null);
    assert.equal(setOptionProblem(fakeChart(noop, []), { title: { text: "Only a title" } }), null);
  });

  it("returns what setOption threw, an Error or not", () => {
    const throwing = (thrown: unknown) =>
      fakeChart(() => {
        throw thrown;
      }, []);
    assert.equal(setOptionProblem(throwing(new Error("broken")), {}), "broken");
    assert.equal(setOptionProblem(throwing("plain"), {}), "plain");
  });

  it("does not call setOption for a map that is not registered", () => {
    const calls: string[] = [];
    const problem = setOptionProblem(
      fakeChart(() => calls.push("setOption"), []),
      { series: [{ type: "map", map: "atlantis" }] },
    );
    assert.match(problem ?? "", /atlantis/);
    assert.deepEqual(calls, []);
  });
});

describe("executeChart draws each chart before saving", () => {
  it("saves a document whose charts all draw", async () => {
    const artifacts = memoryArtifacts();
    const result = await executeChart({ files: { artifacts } }, { document: { charts: [{ option: DRAWABLE }] } });
    assert.ok(result.data);
    assert.equal(artifacts.written.length, 1);
  });

  it("saves nothing and names each chart that cannot be drawn, with its reason", async () => {
    const artifacts = memoryArtifacts();
    const document = {
      charts: [
        { option: DRAWABLE },
        { title: "Sales", option: { series: [{ type: "bar", data: [1] }] } },
        { option: { series: [{ type: "barr", data: [1] }] } },
      ],
    };
    const result = await executeChart({ files: { artifacts } }, { document });
    assert.equal(result.data, undefined);
    assert.equal(artifacts.written.length, 0);
    const lines = (result.message ?? "").split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? "", /^Chart 2 \(Sales\) could not be drawn: The series need xAxis and yAxis/);
    assert.match(lines[1] ?? "", /^Chart 3 could not be drawn: Unknown series type "barr"/);
    assert.match(result.instructions ?? "", /presentChart again/);
  });

  it("draws a sourced chart with the rows the View will give it", async () => {
    const rows: ChartSourceRows = [
      ["Spend", "Sales"],
      [1, 2],
      [2, 4],
    ];
    // Without the rows the regression has no column to read, and ECharts throws.
    const option = {
      dataset: [{}, { transform: { type: "ecStat:regression" } }],
      xAxis: { type: "value" },
      yAxis: {},
      series: [{ type: "line", datasetIndex: 1 }],
    };
    const source = { spreadsheet: "artifacts/spreadsheets/a.json", range: "A1:B2" };
    const artifacts = memoryArtifacts();
    const result = await executeChart({ files: { artifacts }, sources: { read: async () => rows } }, { document: { charts: [{ source, option }] } });
    assert.ok(result.data, result.message);
  });
});
