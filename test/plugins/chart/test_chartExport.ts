// What a chart's CSV holds, how it is written, what its files are called, and that the SVG drawn
// off screen (as the View exports it) carries the chart in either theme.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chartCsvRows, fileSlug, toCsv } from "../../../packages/plugins/chart-plugin/src/core/exportData";
import { withSourceRows } from "../../../packages/plugins/chart-plugin/src/core/source";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";

describe("chartCsvRows", () => {
  it("takes a sheet's rows from the dataset they were drawn into", () => {
    const rows = [
      ["Month", "Sales"],
      ["Jan", 100],
    ];
    assert.deepEqual(chartCsvRows(withSourceRows({ series: [{ type: "bar" }] }, rows)), rows);
  });

  it("takes the first table among several datasets, skipping a transform", () => {
    const option = { dataset: [{ transform: { type: "filter" } }, { source: [["a"], [1]] }, { source: [["b"], [2]] }] };
    assert.deepEqual(chartCsvRows(option), [["a"], [1]]);
  });

  it("lays inline data out as the category axis against each series, named or numbered", () => {
    const option = {
      xAxis: { type: "category", data: ["Jan", "Feb"] },
      series: [
        { type: "bar", name: "Sales", data: [100, { value: 120, itemStyle: {} }] },
        { type: "line", data: [1] },
      ],
    };
    assert.deepEqual(chartCsvRows(option), [
      ["", "Sales", "Series 2"],
      ["Jan", 100, 1],
      ["Feb", 120, null],
    ]);
  });

  it("finds the category axis on y for horizontal bars", () => {
    const option = { xAxis: { type: "value" }, yAxis: [{ type: "category", data: ["A"] }], series: [{ type: "bar", data: [3] }] };
    assert.deepEqual(chartCsvRows(option), [
      ["", "Series 1"],
      ["A", 3],
    ]);
  });

  it("is null for data with no table shape", () => {
    assert.equal(chartCsvRows({ series: [{ type: "pie", data: [{ name: "a", value: 1 }] }] }), null);
    assert.equal(chartCsvRows({ xAxis: { type: "category", data: ["a"] }, series: [{ type: "bar", datasetIndex: 0 }] }), null);
    assert.equal(chartCsvRows({ xAxis: { type: "category", data: ["a"] }, series: [] }), null);
    assert.equal(chartCsvRows({ dataset: { source: [{ a: 1 }] } }), null);
  });
});

describe("toCsv", () => {
  it("writes CRLF lines, empty cells for nothing, and quotes what needs it", () => {
    assert.equal(
      toCsv([
        ["name", "note"],
        ["a,b", 'say "hi"'],
        ["line\nbreak", null],
        [1.5, true],
      ]),
      'name,note\r\n"a,b","say ""hi"""\r\n"line\nbreak",\r\n1.5,true\r\n',
    );
  });

  it("keeps text a spreadsheet would run as a formula as text, and leaves numbers alone", () => {
    assert.equal(toCsv([["=SUM(A1)", "+1", "-x", "@x", -5]]), "'=SUM(A1),'+1,'-x,'@x,-5\r\n");
  });

  it("writes nothing for no rows", () => {
    assert.equal(toCsv([]), "");
  });
});

describe("fileSlug", () => {
  it("keeps lowercase letters, digits and dashes, joined by single dashes", () => {
    assert.equal(fileSlug("Sales by Region 2026!"), "sales-by-region-2026");
    assert.equal(fileSlug("--a--b--"), "a--b");
  });

  it("is chart when nothing is left", () => {
    ["", "売上", "---", "!!!"].forEach((title) => assert.equal(fileSlug(title), "chart", title));
  });

  it("handles a long run of dashes quickly", () => {
    const started = performance.now();
    assert.equal(fileSlug(`${"-".repeat(100000)}x`), "x");
    assert.ok(performance.now() - started < 1000);
  });
});

describe("SVG drawn off screen", () => {
  const option = { xAxis: { type: "category", data: ["Jan"] }, yAxis: {}, series: [{ type: "bar", data: [3] }], animation: false };

  for (const theme of [undefined, "dark"]) {
    it(`holds the chart in the ${theme ?? "default"} theme, on the background asked for`, () => {
      const background = theme ? "#111827" : "#ffffff";
      const chart = echarts.init(null, theme, { renderer: "svg", ssr: true, width: 320, height: 200 });
      try {
        chart.setOption({ ...option, backgroundColor: background });
        const svg = chart.renderToSVGString();
        assert.match(svg, /^<svg/);
        assert.ok(svg.includes("Jan"));
        assert.ok(svg.toLowerCase().includes(background), "background");
      } finally {
        chart.dispose();
      }
    });
  }

  it("draws the axis text lighter in the dark theme", () => {
    const labelFills = (theme: string | undefined): string[] => {
      const chart = echarts.init(null, theme, { renderer: "svg", ssr: true, width: 320, height: 200 });
      try {
        chart.setOption(option);
        return [...chart.renderToSVGString().matchAll(/fill="([^"]+)"/g)].map((match) => match[1] ?? "");
      } finally {
        chart.dispose();
      }
    };
    const light = labelFills(undefined);
    const dark = labelFills("dark");
    assert.ok(
      dark.some((fill) => !light.includes(fill)),
      `${light.join(" ")} / ${dark.join(" ")}`,
    );
  });
});
