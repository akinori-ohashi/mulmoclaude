// A word cloud is drawn by @modernized/echarts-wordcloud in the browser. These pin what a series
// may say, where its words come from, the series the extension is given, and that the server
// checks only a word cloud's formats.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import globalDefault from "echarts/lib/model/globalDefault.js";
import { cloudStyle, cloudWords, withWordClouds, wordCloudProblem, type CloudStyle } from "../../../packages/plugins/chart-plugin/src/core/wordCloud";
import { executeChart } from "../../../packages/plugins/chart-plugin/src/core/plugin";
import { memoryArtifacts } from "./memoryArtifacts";

const PALETTE = globalDefault.color;

const STYLE: CloudStyle = { sizeRange: [12, 60], rotationRange: [0, 90], rotationStep: 90, gridSize: 8 };

describe("cloudStyle", () => {
  it("takes valid settings and falls back per setting", () => {
    assert.deepEqual(cloudStyle({}), STYLE);
    assert.deepEqual(cloudStyle({ sizeRange: [10, 40], rotationRange: [-45, 45], rotationStep: 15, gridSize: 4 }), {
      sizeRange: [10, 40],
      rotationRange: [-45, 45],
      rotationStep: 15,
      gridSize: 4,
    });
    assert.equal(cloudStyle({ gridSize: 2 }).gridSize, STYLE.gridSize);
    const wrong = cloudStyle({ sizeRange: [40, 10], rotationRange: [0, 180], rotationStep: 0, gridSize: 1000 });
    assert.deepEqual(wrong, STYLE);
    assert.deepEqual(cloudStyle({ sizeRange: "big", rotationRange: [0], rotationStep: "45", gridSize: Number.NaN }), STYLE);
  });
});

describe("cloudWords", () => {
  it("reads { name, value } and [name, value] items, skipping what is not a word and a number", () => {
    const series = { data: [{ name: "a", value: 3 }, ["b", "4"], { name: "", value: 1 }, ["c"], { name: "d", value: "x" }, 7, null, [5, 2]] };
    assert.deepEqual(cloudWords({}, series), [
      { name: "a", value: 3 },
      { name: "b", value: 4 },
      { name: "5", value: 2 },
    ]);
  });

  it("reads a sheet's rows from the dataset: the first two columns, or the encoded ones", () => {
    const dataset = {
      source: [
        ["Word", "Note", "Count"],
        ["sales", "x", 10],
        ["cost", "y", 4],
      ],
      sourceHeader: true,
    };
    assert.deepEqual(cloudWords({ dataset }, {}), []);
    assert.deepEqual(cloudWords({ dataset }, { encode: { itemName: "Word", value: "Count" } }), [
      { name: "sales", value: 10 },
      { name: "cost", value: 4 },
    ]);
    assert.deepEqual(cloudWords({ dataset: [{}, dataset] }, { datasetIndex: 1, encode: { itemName: 0, value: [2] } }), [
      { name: "sales", value: 10 },
      { name: "cost", value: 4 },
    ]);
  });

  it("finds a header row on its own, and takes the series' data over the dataset", () => {
    const headed = {
      source: [
        ["Word", "Count"],
        ["a", 2],
      ],
    };
    assert.deepEqual(cloudWords({ dataset: headed }, {}), [{ name: "a", value: 2 }]);
    const bare = {
      source: [
        ["a", 2],
        ["b", 1],
      ],
    };
    assert.deepEqual(cloudWords({ dataset: bare }, {}), [
      { name: "a", value: 2 },
      { name: "b", value: 1 },
    ]);
    assert.deepEqual(cloudWords({ dataset: bare }, { data: [{ name: "own", value: 1 }] }), [{ name: "own", value: 1 }]);
    assert.deepEqual(cloudWords({ dataset: "nope" }, {}), []);
    const textNumbers = {
      source: [
        ["sales", "2"],
        ["cost", "1"],
      ],
    };
    assert.deepEqual(cloudWords({ dataset: textNumbers }, {}), [
      { name: "sales", value: 2 },
      { name: "cost", value: 1 },
    ]);
  });

  it("keeps the largest words, in their order, past the limit", () => {
    const many = Array.from({ length: 400 }, (_, index) => ({ name: `w${index}`, value: index }));
    const kept = cloudWords({}, { data: many });
    assert.equal(kept.length, 300);
    assert.deepEqual(kept[0], { name: "w100", value: 100 });
    assert.deepEqual(kept[kept.length - 1], { name: "w399", value: 399 });
  });
});

describe("withWordClouds", () => {
  it("leaves an option without a word cloud as it is", () => {
    const option = { series: [{ type: "bar", data: [1] }] };
    assert.equal(withWordClouds(option), option);
  });

  it("keeps the series a wordCloud, with its words in data and its settings in range", () => {
    const option = {
      tooltip: {},
      series: { type: "wordCloud", name: "Topics", shape: "star", sizeRange: [10, 30], rotationStep: 0, data: [{ name: "a", value: 1 }, ["b", "2"]] },
    };
    const drawn = withWordClouds(option);
    assert.deepEqual(drawn.series, {
      type: "wordCloud",
      name: "Topics",
      shape: "star",
      ...STYLE,
      sizeRange: [10, 30],
      data: [
        { name: "a", value: 1, textStyle: { color: PALETTE[0] } },
        { name: "b", value: 2, textStyle: { color: PALETTE[1] } },
      ],
    });
    assert.equal(option.series.rotationStep, 0, "the saved option is not changed");
  });

  it("writes a sheet range's rows into data and drops what only pointed at them", () => {
    const option = {
      dataset: [
        {},
        {
          source: [
            ["Word", "Count"],
            ["sales", 10],
            ["cost", 4],
          ],
        },
      ],
      series: [{ type: "bar" }, { type: "wordCloud", datasetIndex: 1, encode: { itemName: "Word", value: "Count" } }],
    };
    const { series } = withWordClouds(option);
    assert.ok(Array.isArray(series));
    const [bar, cloud] = series;
    assert.deepEqual(bar, { type: "bar" });
    assert.deepEqual(cloud, {
      type: "wordCloud",
      ...STYLE,
      data: [
        { name: "sales", value: 10, textStyle: { color: PALETTE[0] } },
        { name: "cost", value: 4, textStyle: { color: PALETTE[1] } },
      ],
    });
  });
});

describe("word colours", () => {
  const words = (option: Record<string, unknown>): unknown[] => {
    const { series } = withWordClouds(option);
    const cloud: unknown = Array.isArray(series) ? series[0] : series;
    const data: unknown = typeof cloud === "object" && cloud !== null ? Reflect.get(cloud, "data") : undefined;
    return Array.isArray(data) ? data : [];
  };
  const colours = (option: Record<string, unknown>): unknown[] =>
    words(option).map((word) => (typeof word === "object" && word !== null ? Reflect.get(Object(Reflect.get(word, "textStyle")), "color") : undefined));
  const many = Array.from({ length: PALETTE.length + 2 }, (_, index) => ({ name: `w${index}`, value: 100 - index }));

  it("gives each word the palette's next colour, as the word cloud did before 4.6.0, starting over when it runs out", () => {
    assert.deepEqual(colours({ series: { type: "wordCloud", data: many } }), [...PALETTE, PALETTE[0], PALETTE[1]]);
  });

  it("takes the option's own palette when it has one", () => {
    assert.deepEqual(colours({ color: ["#111", "#222"], series: { type: "wordCloud", data: many.slice(0, 3) } }), ["#111", "#222", "#111"]);
  });

  it("keeps a colour the author gave a word, and gives none when the author coloured the whole series", () => {
    const data = [
      { name: "a", value: 3, textStyle: { color: "#f00" } },
      { name: "b", value: 2 },
    ];
    assert.deepEqual(colours({ series: { type: "wordCloud", data } }), ["#f00", PALETTE[1]]);
    assert.deepEqual(colours({ series: { type: "wordCloud", textStyle: { color: "#0f0" }, data } }), [undefined, undefined]);
  });
});

describe("wordCloudProblem", () => {
  it("is null for a word cloud in the option's own series, or none at all", () => {
    assert.equal(wordCloudProblem({ series: [{ type: "wordCloud" }] }), null);
    assert.equal(wordCloudProblem({ baseOption: { series: [{ type: "bar" }] }, options: [{ series: [{ data: [1] }] }] }), null);
  });

  it("names a word cloud inside a timeline", () => {
    assert.match(wordCloudProblem({ baseOption: { series: [{ type: "wordCloud" }] }, options: [{ series: [{ data: [] }] }] }) ?? "", /timeline/);
    assert.match(wordCloudProblem({ options: [{ series: { type: "wordCloud" } }] }) ?? "", /timeline/);
  });
});

describe("executeChart with a word cloud", () => {
  it("saves a word cloud without drawing it on the server, but still checks its formats", async () => {
    const wordCloud = { option: { series: [{ type: "wordCloud", data: [{ name: "a", value: 3 }] }] } };
    const saved = await executeChart({ files: { artifacts: memoryArtifacts() } }, { document: { charts: [wordCloud] } });
    assert.ok(saved.data, saved.message);
    const badFormat = { option: { tooltip: { valueFormatter: { kind: "money" } }, series: [{ type: "wordCloud", data: [{ name: "a", value: 3 }] }] } };
    const refused = await executeChart({ files: { artifacts: memoryArtifacts() } }, { document: { charts: [badFormat] } });
    assert.equal(refused.data, undefined);
    assert.match(refused.message ?? "", /Invalid format/);
  });

  it("refuses a word cloud inside a timeline, saying why", async () => {
    const timeline = {
      option: { baseOption: { timeline: {}, series: [{ type: "wordCloud" }] }, options: [{ series: [{ data: [{ name: "a", value: 1 }] }] }] },
    };
    const refused = await executeChart({ files: { artifacts: memoryArtifacts() } }, { document: { charts: [timeline] } });
    assert.equal(refused.data, undefined);
    assert.match(refused.message ?? "", /timeline/);
  });
});
