import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { withMapData } from "../../../packages/plugins/chart-plugin/src/core/mapData";
import { withSourceRows } from "../../../packages/plugins/chart-plugin/src/core/source";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";
import { loadMaps } from "../../../packages/plugins/chart-plugin/src/core/extensions";

const ROWS = [
  ["都道府県", "売上"],
  ["東京都", 2359],
  ["北海道", 612],
  ["大阪府", 1845],
];
const MAP_SERIES = { type: "map", map: "japan-ja", encode: { itemName: "都道府県", value: "売上" } };
const VISUAL_MAP = { min: 0, max: 2400, inRange: { color: ["#eeeeff", "#0000ff"] } };

const firstSeries = (option: Record<string, unknown>): Record<string, unknown> => {
  const { series } = option;
  const first: unknown = Array.isArray(series) ? series[0] : series;
  assert.ok(typeof first === "object" && first !== null && !Array.isArray(first));
  return Object.fromEntries(Object.entries(first));
};

describe("withMapData", () => {
  it("returns an option with no map series as it is", () => {
    const option = { dataset: { source: ROWS }, series: [{ type: "bar" }] };
    assert.equal(withMapData(option), option);
  });

  it("writes a sourced map's rows into data, by the columns encode names, and drops encode", () => {
    const series = firstSeries(withMapData(withSourceRows({ series: [{ ...MAP_SERIES, encode: { itemName: "都道府県", value: "売上" } }] }, ROWS)));
    assert.deepEqual(series.data, [
      { name: "東京都", value: 2359 },
      { name: "北海道", value: 612 },
      { name: "大阪府", value: 1845 },
    ]);
    assert.equal(series.encode, undefined);
    assert.equal(series.map, "japan-ja");
  });

  it("takes the first two columns without encode, and finds named columns in any order", () => {
    const plain = firstSeries(withMapData(withSourceRows({ series: { type: "map", map: "japan-ja" } }, ROWS)));
    assert.deepEqual(plain.data, [
      { name: "東京都", value: 2359 },
      { name: "北海道", value: 612 },
      { name: "大阪府", value: 1845 },
    ]);
    const swapped = [
      ["Sales", "Region", "Note"],
      [10, "Tokyo", "x"],
    ];
    const named = firstSeries(
      withMapData(withSourceRows({ series: [{ type: "map", map: "japan", encode: { itemName: "Region", value: "Sales" } }] }, swapped)),
    );
    assert.deepEqual(named.data, [{ name: "Tokyo", value: 10 }]);
  });

  it("skips a row with no number for its value, and reads a number written as text", () => {
    const rows = [
      ["Region", "Sales"],
      ["Tokyo", ""],
      ["Osaka", null],
      ["Kyoto", "12"],
      ["", 5],
    ];
    const series = firstSeries(withMapData(withSourceRows({ series: [{ type: "map", map: "japan" }] }, rows)));
    assert.deepEqual(series.data, [{ name: "Kyoto", value: 12 }]);
  });

  it("keeps a map that has data of its own", () => {
    const own = { type: "map", map: "japan", data: [{ name: "Tokyo", value: 1 }] };
    const option = withMapData({ dataset: { source: ROWS }, series: [own] });
    assert.deepEqual(firstSeries(option), own);
  });

  it("keeps a map reading a row-wise dataset, which ECharts reads by column", () => {
    const series = { type: "map", map: "japan", seriesLayoutBy: "row" };
    const option = withMapData({
      dataset: {
        source: [
          ["Tokyo", "Osaka"],
          [10, 20],
        ],
        sourceHeader: true,
      },
      series: [series],
    });
    assert.deepEqual(firstSeries(option), series);
  });

  it("keeps a map whose rows are not the sheet's own shape, which ECharts reads another way", () => {
    const encode = { itemName: "Region", value: "Sales" };
    const shapes = [
      { dataset: { source: [{ Region: "Tokyo", Sales: 10 }], sourceHeader: true }, series: [{ type: "map", map: "japan", encode }] },
      {
        dataset: {
          source: [
            ["Sales", "Region"],
            [10, "Tokyo"],
          ],
          sourceHeader: "auto",
        },
        series: [{ type: "map", map: "japan", encode }],
      },
      { dataset: [{ id: "raw", source: ROWS, sourceHeader: true }], series: [{ type: "map", map: "japan-ja", datasetId: "raw" }] },
      { dataset: { source: ROWS, sourceHeader: true, dimensions: ["売上", "都道府県"] }, series: [{ type: "map", map: "japan-ja" }] },
      { dataset: { source: ROWS, sourceHeader: true }, series: [{ type: "map", map: "japan-ja", dimensions: ["売上", "都道府県"] }] },
    ];
    shapes.forEach((option) => assert.deepEqual(withMapData(option), option));
  });

  it("keeps a map whose data is an empty list, which ECharts draws with no items", () => {
    const option = { dataset: { source: ROWS, sourceHeader: true }, series: [{ ...MAP_SERIES, data: [] }] };
    assert.deepEqual(firstSeries(withMapData(option)).data, []);
  });

  it("keeps the option whole when a visualMap names the column it colours by", () => {
    const option = withSourceRows({ visualMap: { dimension: "売上", min: 0, max: 2400 }, series: [MAP_SERIES] }, ROWS);
    assert.equal(withMapData(option), option);
  });

  it("leaves a map inside a timeline as it is", () => {
    const option = { baseOption: { timeline: {}, dataset: { source: ROWS }, series: [MAP_SERIES] }, options: [{}] };
    assert.equal(withMapData(option), option);
  });

  it("keeps a map reading a transform's output, which has no rows of its own", () => {
    const series = { type: "map", map: "japan", datasetIndex: 1, encode: { itemName: "Region", value: "Sales" } };
    const option = withMapData({ dataset: [{ source: ROWS }, { transform: { type: "filter", config: { dimension: 1, ">": 0 } } }], series: [series] });
    assert.deepEqual(firstSeries(option), series);
  });
});

/** How many region shapes the drawn SVG fills with each colour. Region paths are long; the
 *  visualMap's own shapes are short, so the length keeps them out of the count. */
function regionFills(option: Record<string, unknown>): Map<string, number> {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 600, height: 600 });
  try {
    chart.setOption(option);
    const fills = new Map<string, number>();
    for (const [, fill] of chart.renderToSVGString().matchAll(/<path d="M[^"]{200,}"[^>]*fill="([^"]+)"/g)) {
      if (fill !== undefined) fills.set(fill, (fills.get(fill) ?? 0) + 1);
    }
    return fills;
  } finally {
    chart.dispose();
  }
}

describe("a map drawn from a sheet range", () => {
  before(() => loadMaps(["japan-ja"]));

  it("is painted region by region as the same values written into data are", () => {
    const sourced = regionFills(withMapData(withSourceRows({ visualMap: VISUAL_MAP, series: [MAP_SERIES] }, ROWS)));
    const inline = regionFills({
      visualMap: VISUAL_MAP,
      series: [{ type: "map", map: "japan-ja", data: ROWS.slice(1).map(([name, value]) => ({ name, value })) }],
    });
    assert.deepEqual([...sourced].sort(), [...inline].sort());
  });

  it("does not paint the regions with no row in the series colour, as the dataset alone does", () => {
    const raw = regionFills(withSourceRows({ visualMap: VISUAL_MAP, series: [MAP_SERIES] }, ROWS));
    const fixed = regionFills(withMapData(withSourceRows({ visualMap: VISUAL_MAP, series: [MAP_SERIES] }, ROWS)));
    const mostPainted = (fills: Map<string, number>): string | undefined => [...fills].sort((left, right) => right[1] - left[1])[0]?.[0];
    assert.notEqual(mostPainted(raw), mostPainted(fixed));
  });
});
