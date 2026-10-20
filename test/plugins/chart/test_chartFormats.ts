// A format object stands in for a formatter function, which JSON cannot carry. These pin what a
// format accepts, what it writes, where it is replaced, and that ECharts draws its text.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatProblem,
  formatShapeProblem,
  isChartFormat,
  valueFormatter,
  withFormatters,
  type ChartFormat,
} from "../../../packages/plugins/chart-plugin/src/core/formats";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";
import { executeChart } from "../../../packages/plugins/chart-plugin/src/core/plugin";
import { memoryArtifacts } from "./memoryArtifacts";

const LOCALE = "en-US";

const formatterAt = (option: Record<string, unknown>, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>((holder, step) => (holder === null || typeof holder !== "object" ? undefined : Reflect.get(holder, step)), option);

const isFormatterFunction = (value: unknown): value is (input: unknown) => unknown => typeof value === "function";

function call(formatter: unknown, input: unknown): unknown {
  assert.ok(isFormatterFunction(formatter), "not replaced by a function");
  return formatter(input);
}

describe("format shapes", () => {
  const valid: ChartFormat[] = [
    { kind: "number" },
    { kind: "number", digits: 0, grouping: false, compact: true, prefix: "~", suffix: " pts", template: "{b}: {value}" },
    { kind: "percent", digits: 1 },
    { kind: "currency", currency: "JPY" },
    { kind: "currency", currency: "usd", digits: 2 },
    { kind: "date", pattern: "{yyyy}-{MM}" },
  ];
  for (const format of valid) {
    it(`accepts ${JSON.stringify(format)}`, () => assert.equal(isChartFormat(format), true));
  }

  const invalid: [Record<string, unknown>, RegExp][] = [
    [{ kind: "money" }, /"kind" must be one of/],
    [{ kind: "toString" }, /"kind" must be one of/],
    [{ kind: "number", constructor: 1 }, /"constructor" is not a valid field/],
    [{}, /"kind" must be one of/],
    [{ kind: "number", digits: -1 }, /"digits"/],
    [{ kind: "number", digits: 21 }, /"digits"/],
    [{ kind: "number", digits: 1.5 }, /"digits"/],
    [{ kind: "number", digits: "2" }, /"digits"/],
    [{ kind: "number", grouping: "no" }, /"grouping"/],
    [{ kind: "number", currency: "JPY" }, /"currency" is not a valid field of a number format/],
    [{ kind: "percent", suffix: "%" }, /"suffix"/],
    [{ kind: "currency" }, /needs "currency"/],
    [{ kind: "currency", currency: "YEN1" }, /"currency"/],
    [{ kind: "date" }, /needs "pattern"/],
    [{ kind: "date", pattern: 3 }, /"pattern"/],
    [{ kind: "number", template: 1 }, /"template"/],
  ];
  for (const [format, reason] of invalid) {
    it(`rejects ${JSON.stringify(format)}`, () => {
      assert.match(formatShapeProblem(format) ?? "", reason);
      assert.equal(isChartFormat(format), false);
    });
  }

  it("rejects what is not an object", () => {
    [null, undefined, "number", 3, [{ kind: "number" }]].forEach((value) => assert.equal(isChartFormat(value), false));
  });
});

describe("valueFormatter", () => {
  const write = (format: ChartFormat, value: unknown) => valueFormatter(format, LOCALE)(value);

  it("writes numbers with separators, digits, affixes and the compact form", () => {
    assert.equal(write({ kind: "number" }, 1234567.891), "1,234,567.891");
    assert.equal(write({ kind: "number", digits: 1 }, 1234.56), "1,234.6");
    assert.equal(write({ kind: "number", digits: 2 }, 3), "3.00");
    assert.equal(write({ kind: "number", grouping: false }, 1234), "1234");
    assert.equal(write({ kind: "number", compact: true }, 1234567), "1.2M");
    assert.equal(write({ kind: "number", digits: 1, prefix: "+", suffix: " pts" }, 4), "+4.0 pts");
  });

  it("writes a ratio as a percentage and money in its currency", () => {
    assert.equal(write({ kind: "percent" }, 0.123), "12%");
    assert.equal(write({ kind: "percent", digits: 1 }, 0.1234), "12.3%");
    assert.equal(write({ kind: "currency", currency: "JPY" }, 1234567), "¥1,234,567");
    assert.equal(write({ kind: "currency", currency: "usd", digits: 0 }, 1234.5), "$1,235");
  });

  it("reads a number written as text, as a sheet cell may be", () => {
    assert.equal(write({ kind: "number" }, "1234"), "1,234");
  });

  it("shows what it cannot read as a number as it is, and a missing value as -", () => {
    const format: ChartFormat = { kind: "number", digits: 1 };
    assert.equal(write(format, "Tokyo"), "Tokyo");
    assert.equal(write(format, ""), "");
    assert.equal(write(format, Number.NaN), "NaN");
    assert.equal(write(format, Number.POSITIVE_INFINITY), "Infinity");
    assert.equal(write(format, null), "-");
    assert.equal(write(format, undefined), "-");
  });

  it("writes dates with ECharts' time template, from text or a timestamp", () => {
    const format: ChartFormat = { kind: "date", pattern: "{yyyy}/{MM}/{dd}" };
    assert.equal(write(format, "2026-01-05T00:00:00"), "2026/01/05");
    assert.equal(write(format, new Date(2026, 0, 5).getTime()), "2026/01/05");
    assert.equal(write({ kind: "date", pattern: "{MMM} {yyyy}" }, "2026-03-15T12:00:00"), "Mar 2026");
  });

  it("shows a date it cannot read as it is", () => {
    const format: ChartFormat = { kind: "date", pattern: "{yyyy}" };
    assert.equal(write(format, "soon"), "soon");
    assert.equal(write(format, { when: 1 }), "[object Object]");
    assert.equal(write(format, null), "-");
  });
});

describe("withFormatters", () => {
  const money = { kind: "currency", currency: "JPY" };

  it("replaces a format on every axis of a list, and on a single axis", () => {
    const option = withFormatters({ xAxis: { axisLabel: { formatter: money } }, yAxis: [{}, { axisLabel: { formatter: money } }] }, LOCALE);
    assert.equal(call(formatterAt(option, "xAxis", "axisLabel", "formatter"), 1000), "¥1,000");
    assert.equal(formatterAt(option, "yAxis", 0, "axisLabel"), undefined);
    assert.equal(call(formatterAt(option, "yAxis", 1, "axisLabel", "formatter"), 1000), "¥1,000");
  });

  it("replaces tooltip value formatters, the chart's and a series'", () => {
    const option = withFormatters({ tooltip: { valueFormatter: money }, series: [{ type: "bar", tooltip: { valueFormatter: { kind: "percent" } } }] }, LOCALE);
    assert.equal(call(formatterAt(option, "tooltip", "valueFormatter"), 5), "¥5");
    assert.equal(call(formatterAt(option, "series", 0, "tooltip", "valueFormatter"), 0.5), "50%");
  });

  it("reads a label's number out of a dataset row by the series' encode", () => {
    const option = withFormatters({ series: [{ type: "bar", label: { formatter: { kind: "number" } } }] }, LOCALE);
    const formatter = formatterAt(option, "series", 0, "label", "formatter");
    assert.equal(call(formatter, { value: ["Jan", 1234], encode: { x: [0], y: [1] } }), "1,234");
    assert.equal(call(formatter, { value: [5678, "Jan"], encode: { x: [0], y: [1] } }), "5,678", "a horizontal bar's number is on x");
    assert.equal(call(formatter, { value: 42 }), "42");
    assert.equal(call(formatter, { value: { value: 9000, name: "a" } }), "9,000");
  });

  it("labels a horizontal bar's measure, not its category, when the categories are numbers", () => {
    const label = { formatter: { kind: "number" } };
    const encode = { x: [1], y: [0] };
    const horizontal = withFormatters({ xAxis: { type: "value" }, yAxis: { type: "category" }, series: [{ type: "bar", label }] }, LOCALE);
    assert.equal(call(formatterAt(horizontal, "series", 0, "label", "formatter"), { value: [2020, 1234], encode }), "1,234");
    const byData = withFormatters({ xAxis: {}, yAxis: [{}, { data: [2020] }], series: { type: "bar", yAxisIndex: 1, label } }, LOCALE);
    assert.equal(call(formatterAt(byData, "series", "label", "formatter"), { value: [2020, 1234], encode }), "1,234", "an axis with data is a category axis");
    const vertical = withFormatters({ xAxis: { type: "category" }, yAxis: { type: "value" }, series: [{ type: "bar", label }] }, LOCALE);
    assert.equal(call(formatterAt(vertical, "series", 0, "label", "formatter"), { value: [2020, 1234], encode: { x: [0], y: [1] } }), "1,234");
  });

  it("fills a label template with the series name, item name and pie percent", () => {
    const format = { kind: "number", template: "{a} / {b}: {value} ({d}%)" };
    const option = withFormatters({ series: [{ type: "pie", label: { formatter: format } }] }, LOCALE);
    const text = call(formatterAt(option, "series", 0, "label", "formatter"), { value: 1500, name: "Tea", seriesName: "Sales", percent: 25 });
    assert.equal(text, "Sales / Tea: 1,500 (25%)");
  });

  it("keeps a template's unknown fields, and fills only {value} where ECharts passes a bare value", () => {
    const option = withFormatters({ xAxis: { axisLabel: { formatter: { kind: "number", template: "{b}{value}{c}" } } } }, LOCALE);
    assert.equal(call(formatterAt(option, "xAxis", "axisLabel", "formatter"), 7), "7{c}");
  });

  it("leaves template strings, ECharts' own object formatters, and anything malformed alone", () => {
    const timeLevels = { year: "{yyyy}", month: "{MMM}" };
    const input = {
      xAxis: { type: "time", axisLabel: { formatter: timeLevels } },
      yAxis: { axisLabel: { formatter: "{value} %" } },
      series: [{ type: "bar", label: { formatter: { kind: "money" } } }],
    };
    const option = withFormatters(input, LOCALE);
    assert.deepEqual(option, input);
  });

  it("does not change the option it was given", () => {
    const input = { yAxis: { axisLabel: { formatter: money } } };
    const copy = structuredClone(input);
    withFormatters(input, LOCALE);
    assert.deepEqual(input, copy);
  });

  it("is drawn by ECharts as text", () => {
    const option = withFormatters(
      {
        xAxis: { type: "category", data: ["2026-01-01T00:00:00"], axisLabel: { formatter: { kind: "date", pattern: "{MMM} {yyyy}" } } },
        yAxis: { axisLabel: { formatter: money } },
        series: [{ type: "bar", data: [2000000], label: { show: true, formatter: { kind: "number", compact: true } } }],
      },
      LOCALE,
    );
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 640, height: 400 });
    try {
      chart.setOption(option);
      const svg = chart.renderToSVGString();
      ["Jan 2026", "¥2,000,000", ">2M<"].forEach((text) => assert.ok(svg.includes(text), text));
    } finally {
      chart.dispose();
    }
  });
});

describe("formatProblem", () => {
  it("is null with no formats, with valid ones, and with ECharts' own object formatters", () => {
    assert.equal(formatProblem({ series: [] }), null);
    assert.equal(formatProblem({ yAxis: { axisLabel: { formatter: { kind: "number" } } }, series: [{ label: { formatter: "{b}" } }] }), null);
    assert.equal(formatProblem({ xAxis: { type: "time", axisLabel: { formatter: { year: "{yyyy}" } } } }), null);
  });

  it("names the place and the reason of a malformed format", () => {
    const problem = formatProblem({ series: [{ type: "bar", label: { formatter: { kind: "currency" } } }] });
    assert.match(problem ?? "", /series\.label\.formatter: a currency format needs "currency"/);
  });

  it("names a format put where it is not replaced", () => {
    const problem = formatProblem({ visualMap: { formatter: { kind: "number" } }, series: [{ markLine: { label: { formatter: { kind: "number" } } } }] });
    assert.match(problem ?? "", /only works at .*xAxis\.axisLabel\.formatter/);
    assert.match(problem ?? "", /not at visualMap\.formatter, series\.markLine\.label\.formatter/);
  });
});

describe("executeChart with formats", () => {
  it("saves a chart whose formats are valid", async () => {
    const artifacts = memoryArtifacts();
    const option = {
      xAxis: { type: "category", data: ["a"] },
      yAxis: { axisLabel: { formatter: { kind: "percent" } } },
      series: [{ type: "bar", data: [0.5] }],
    };
    const result = await executeChart({ files: { artifacts } }, { document: { charts: [{ option }] } });
    assert.ok(result.data, result.message);
  });

  it("refuses a chart with a malformed format, naming it", async () => {
    const artifacts = memoryArtifacts();
    const option = {
      xAxis: { type: "category", data: ["a"] },
      yAxis: { axisLabel: { formatter: { kind: "percent", digits: 99 } } },
      series: [{ type: "bar", data: [1] }],
    };
    const result = await executeChart({ files: { artifacts } }, { document: { charts: [{ option }] } });
    assert.equal(result.data, undefined);
    assert.match(result.message ?? "", /Chart 1 could not be drawn: Invalid format: yAxis\.axisLabel\.formatter/);
    assert.equal(artifacts.written.length, 0);
  });
});
