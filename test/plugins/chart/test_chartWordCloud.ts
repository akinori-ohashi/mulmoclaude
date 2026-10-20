// A word cloud is laid out here rather than by echarts-wordcloud. These pin the layout's rules
// (inside the box, no two words over each other, largest first, the same every time), what a
// series may say and where its words come from, and that ECharts draws the result.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fontSizeFor,
  layoutWords,
  rotationChoices,
  textWidthEm,
  type CloudStyle,
  type CloudWord,
  type PlacedWord,
} from "../../../packages/plugins/chart-plugin/src/core/wordCloudLayout";
import { cloudStyle, cloudWords, withWordClouds } from "../../../packages/plugins/chart-plugin/src/core/wordCloud";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";
import { executeChart } from "../../../packages/plugins/chart-plugin/src/core/plugin";
import { seededRandom } from "../../../packages/plugins/chart-plugin/src/core/random";
import { memoryArtifacts } from "./memoryArtifacts";

const STYLE: CloudStyle = { sizeRange: [12, 60], rotationRange: [0, 90], rotationStep: 90, gridSize: 8 };
const BOX = { width: 640, height: 400 };
const LINE_HEIGHT_EM = 1.2;

/** Words with generated names and values, the same for the same seed. */
function generatedWords(count: number, seed: number): CloudWord[] {
  const random = seededRandom(seed);
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: count }, (_, index) => {
    const length = 2 + Math.floor(random() * 9);
    const name = Array.from({ length }, () => letters[Math.floor(random() * letters.length)]).join("");
    return { name: index % 7 === 0 ? `語${name}` : `${name}${index}`, value: Math.round(random() * 1000) };
  });
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function boxOf(word: PlacedWord, name: string): Box {
  const width = textWidthEm(name) * word.fontSize;
  const height = LINE_HEIGHT_EM * word.fontSize;
  const angle = (word.rotationDeg * Math.PI) / 180;
  const halfWidth = (Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))) / 2;
  const halfHeight = (Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))) / 2;
  return { left: word.x - halfWidth, top: word.y - halfHeight, right: word.x + halfWidth, bottom: word.y + halfHeight };
}

const overlaps = (first: Box, second: Box): boolean =>
  first.left < second.right && second.left < first.right && first.top < second.bottom && second.top < first.bottom;

describe("word cloud layout helpers", () => {
  it("estimates full-width characters, broad letters and capitals wider than others", () => {
    assert.equal(textWidthEm(""), 0);
    assert.equal(textWidthEm("東京"), 2 * textWidthEm("都"));
    assert.equal(textWidthEm("都"), textWidthEm("W"));
    assert.ok(textWidthEm("W") > textWidthEm("A") && textWidthEm("A") > textWidthEm("a"));
    assert.equal(textWidthEm("Mm"), 2 * textWidthEm("W"));
  });

  it("sizes linearly between the range, and in the middle when every value is the same", () => {
    assert.equal(fontSizeFor(0, [0, 100], [10, 50]), 10);
    assert.equal(fontSizeFor(100, [0, 100], [10, 50]), 50);
    assert.equal(fontSizeFor(50, [0, 100], [10, 50]), 30);
    assert.equal(fontSizeFor(7, [7, 7], [10, 50]), 30);
  });

  it("offers each angle of the range a step apart, or only its start", () => {
    assert.deepEqual(rotationChoices([0, 90], 90), [0, 90]);
    assert.deepEqual(rotationChoices([-90, 90], 45), [-90, -45, 0, 45, 90]);
    assert.deepEqual(rotationChoices([0, 0], 90), [0]);
    assert.deepEqual(rotationChoices([30, 10], 5), [30]);
    assert.deepEqual(rotationChoices([0, 90], 0), [0]);
    assert.deepEqual(rotationChoices([0, 90], Number.NaN), [0]);
  });
});

describe("layoutWords", () => {
  it("places nothing without words or without room", () => {
    assert.deepEqual(layoutWords([], STYLE, BOX), []);
    assert.deepEqual(layoutWords([{ name: "a", value: 1 }], STYLE, { width: 0, height: 400 }), []);
    assert.deepEqual(layoutWords([{ name: "a", value: 1 }], STYLE, { width: 640, height: Number.NaN }), []);
  });

  it("puts the largest word in the middle at the largest size", () => {
    const [first] = layoutWords(
      [
        { name: "small", value: 1 },
        { name: "big", value: 9 },
      ],
      { ...STYLE, rotationRange: [0, 0] },
      BOX,
    );
    assert.ok(first);
    assert.equal(first.index, 1);
    assert.equal(first.fontSize, 60);
    assert.deepEqual([first.x, first.y], [BOX.width / 2, BOX.height / 2]);
  });

  [3, 17, 60, 150].forEach((count) => {
    [11, 29].forEach((seed) => {
      const words = generatedWords(count, seed);
      [BOX, { width: 300, height: 500 }, { width: 160, height: 160 }].forEach((box) => {
        it(`keeps ${count} words (seed ${seed}) inside ${box.width}x${box.height}, none over another`, () => {
          const placed = layoutWords(words, STYLE, box);
          const boxes = placed.map((word) => boxOf(word, words[word.index]?.name ?? ""));
          boxes.forEach((wordBox) => {
            assert.ok(wordBox.left >= 0 && wordBox.top >= 0 && wordBox.right <= box.width && wordBox.bottom <= box.height);
          });
          boxes.forEach((first, i) => boxes.slice(i + 1).forEach((second) => assert.ok(!overlaps(first, second), JSON.stringify([first, second]))));
          assert.equal(new Set(placed.map(({ index }) => index)).size, placed.length);
        });
      });
    });
  });

  it("sizes words by the measure it is given", () => {
    const word = [{ name: "a", value: 1 }];
    const box = { width: 100, height: 100 };
    assert.equal(layoutWords(word, STYLE, box, () => 1000).length, 0);
    assert.equal(layoutWords(word, STYLE, box, () => 10).length, 1);
  });

  it("gives the same layout every time", () => {
    const words = generatedWords(80, 5);
    assert.deepEqual(layoutWords(words, STYLE, BOX), layoutWords(words, STYLE, BOX));
  });

  it("leaves out a word that fits nowhere, and keeps the rest", () => {
    const words = [
      { name: "fits", value: 1 },
      { name: "averyveryverylongwordthatcannotfit", value: 2 },
    ];
    const placed = layoutWords(words, { ...STYLE, rotationRange: [0, 0], sizeRange: [12, 60] }, { width: 200, height: 100 });
    assert.deepEqual(
      placed.map(({ index }) => index),
      [0],
    );
  });

  it("turns words only by the angles offered", () => {
    const placed = layoutWords(generatedWords(60, 3), { ...STYLE, rotationRange: [-90, 90], rotationStep: 45 }, BOX);
    assert.ok(placed.every(({ rotationDeg }) => [-90, -45, 0, 45, 90].includes(rotationDeg)));
    assert.ok(new Set(placed.map(({ rotationDeg }) => rotationDeg)).size > 1);
  });

  it("keeps words with full-width characters level, whatever angle they drew", () => {
    const words = ["東京都", "売上", "revenue", "growth", "在庫", "margin"].map((name, index) => ({ name, value: 10 - index }));
    const placed = layoutWords(words, { ...STYLE, rotationRange: [90, 90] }, BOX);
    const angles = Object.fromEntries(placed.map(({ index, rotationDeg }) => [words[index]?.name, rotationDeg]));
    assert.deepEqual(angles, { 東京都: 0, 売上: 0, revenue: 90, growth: 90, 在庫: 0, margin: 90 });
  });

  it("places more words with a finer grid", () => {
    const words = generatedWords(150, 8);
    assert.ok(layoutWords(words, { ...STYLE, gridSize: 4 }, BOX).length >= layoutWords(words, { ...STYLE, gridSize: 24 }, BOX).length);
  });
});

describe("cloudStyle", () => {
  it("takes valid settings and falls back per setting", () => {
    assert.deepEqual(cloudStyle({}), STYLE);
    assert.deepEqual(cloudStyle({ sizeRange: [10, 40], rotationRange: [-45, 45], rotationStep: 15, gridSize: 4 }), {
      sizeRange: [10, 40],
      rotationRange: [-45, 45],
      rotationStep: 15,
      gridSize: 4,
    });
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

  it("turns a word cloud into a custom series that keeps the series' other settings", () => {
    const option = { tooltip: {}, series: { type: "wordCloud", name: "Topics", sizeRange: [10, 30], data: [{ name: "a", value: 1 }] } };
    const drawn = withWordClouds(option);
    const { series } = drawn;
    assert.ok(typeof series === "object" && series !== null && !Array.isArray(series));
    assert.equal(Reflect.get(series, "type"), "custom");
    assert.equal(Reflect.get(series, "name"), "Topics");
    assert.equal(Reflect.get(series, "colorBy"), "data");
    assert.equal(Reflect.get(series, "sizeRange"), undefined);
    assert.deepEqual(Reflect.get(series, "data"), [{ name: "a", value: 1 }]);
    assert.equal(option.series.type, "wordCloud");
  });

  it("is drawn by ECharts as one text per placed word, each in its own colour", () => {
    const words = ["chart", "map", "sheet", "東京"].map((name, index) => ({ name, value: 10 - index }));
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 640, height: 400 });
    try {
      chart.setOption(withWordClouds({ series: [{ type: "wordCloud", data: words }] }));
      const svg = chart.renderToSVGString();
      words.forEach(({ name }) => assert.ok(svg.includes(`>${name}</text>`), name));
      const fills = new Set([...svg.matchAll(/<text[^>]*fill="([^"]+)"/g)].map((match) => match[1]));
      assert.equal(fills.size, words.length);
    } finally {
      chart.dispose();
    }
  });
});

describe("executeChart with a word cloud", () => {
  it("saves a word cloud after drawing it on the server", async () => {
    const wordCloud = { option: { series: [{ type: "wordCloud", data: [{ name: "a", value: 3 }] }] } };
    const result = await executeChart({ files: { artifacts: memoryArtifacts() } }, { document: { charts: [wordCloud] } });
    assert.ok(result.data, result.message);
  });
});
