import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CHART_DRIVER_JS, DEFAULT_CANVAS, authorScriptTag, beatPreviewDocument, buildBeatHtmlDocument, previewOptionsOf } from "../src/vue/beatHtml.js";

const OPTIONS = previewOptionsOf({});

const textSlide = { text: "hi", image: { type: "textSlide", slide: { title: "Quarterly review", bullets: ["Revenue up"] } } };
const markdown = { text: "hi", image: { type: "markdown", markdown: ["# Heading", "", "- point one"] } };
const mermaid = { text: "hi", image: { type: "mermaid", title: "Flow", code: { kind: "text", text: "graph TD; A-->B" } } };

describe("beatPreviewDocument", () => {
  it("draws a textSlide beat as a sandbox-ready page carrying its content and a CSP", () => {
    const doc = beatPreviewDocument(textSlide, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /Quarterly review/);
    assert.match(doc, /Content-Security-Policy/);
    assert.match(doc, /default-src 'none'/);
  });

  it("draws a markdown beat", () => {
    const doc = beatPreviewDocument(markdown, 1, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /Heading/);
    assert.match(doc, /point one/);
  });

  it("loads mermaid only for a beat that needs it, and prefixes its element ids with the beat index", () => {
    const mermaidDoc = beatPreviewDocument(mermaid, 3, OPTIONS);
    assert.ok(mermaidDoc);
    assert.match(mermaidDoc, /mermaid@10/);
    assert.match(mermaidDoc, /mermaid\.initialize/);
    assert.match(mermaidDoc, /beat-3/);
    const markdownDoc = beatPreviewDocument(markdown, 1, OPTIONS);
    assert.ok(markdownDoc);
    assert.doesNotMatch(markdownDoc, /mermaid@10/);
    assert.doesNotMatch(markdownDoc, /npm\/chart\.js/);
  });

  it("returns null for a beat beatToHtml cannot draw, so the PNG path stays", () => {
    assert.equal(beatPreviewDocument({ text: "narration only" }, 0, OPTIONS), null);
    assert.equal(beatPreviewDocument({ text: "x", imagePrompt: "a cat" }, 0, OPTIONS), null);
  });

  it("returns null for input that is not a valid beat", () => {
    assert.equal(beatPreviewDocument(null, 0, OPTIONS), null);
    assert.equal(beatPreviewDocument({ image: { type: "textSlide" } }, 0, OPTIONS), null);
  });
});

describe("buildBeatHtmlDocument", () => {
  it("adds Chart.js and its plugins only when the fragment requires them", () => {
    const doc = buildBeatHtmlDocument(
      { html: "<canvas></canvas>", requires: ["chart"], chartPlugins: ["https://cdn.jsdelivr.net/npm/chartjs-chart-sankey"] },
      { canvas: DEFAULT_CANVAS, tailwind: false },
    );
    assert.match(doc, /npm\/chart\.js/);
    assert.match(doc, /chartjs-chart-sankey/);
    assert.doesNotMatch(buildBeatHtmlDocument({ html: "<p>x</p>" }, { canvas: DEFAULT_CANVAS, tailwind: false }), /npm\/chart\.js/);
  });

  it("lays the page out at the canvas size and includes the fragment's own css", () => {
    const doc = buildBeatHtmlDocument({ html: "<p>x</p>", css: ".scoped{color:red}" }, { canvas: { width: 1080, height: 1920 }, tailwind: false });
    assert.match(doc, /width:1080px;height:1920px/);
    assert.match(doc, /\.scoped\{color:red\}/);
  });
});

describe("previewOptionsOf", () => {
  it("defaults to the 1280x720 canvas and no theme", () => {
    const options = previewOptionsOf({});
    assert.deepEqual(options.canvas, { width: 1280, height: 720 });
    assert.equal(options.slideTheme, undefined);
    assert.deepEqual(previewOptionsOf(null).canvas, { width: 1280, height: 720 });
  });

  it("reads the script's canvas size", () => {
    assert.deepEqual(previewOptionsOf({ canvasSize: { width: 1080, height: 1920 } }).canvas, { width: 1080, height: 1920 });
  });

  it("ignores a malformed canvas size", () => {
    assert.deepEqual(previewOptionsOf({ canvasSize: { width: "wide" } }).canvas, { width: 1280, height: 720 });
  });

  it("styles textSlide and markdown beats like the PNG path: default text-slide CSS, overridable per deck", () => {
    const plain = beatPreviewDocument(textSlide, 0, OPTIONS);
    assert.ok(plain);
    assert.match(plain, /font-family: Arial/);
    const custom = beatPreviewDocument(textSlide, 0, previewOptionsOf({ textSlideParams: { cssStyles: ["h1 { color: rebeccapurple }"] } }));
    assert.ok(custom);
    assert.match(custom, /rebeccapurple/);
  });

  it("centres a textSlide without bullets vertically, as the PNG path does", () => {
    const titleOnly = { text: "x", image: { type: "textSlide", slide: { title: "Only a title" } } };
    const doc = beatPreviewDocument(titleOnly, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, new RegExp(`margin-top: ${DEFAULT_CANVAS.height * 0.45}px`));
  });

  it("loads Tailwind for the fragments mulmocast documents as needing it, and not for text beats", () => {
    const tailwindTag = /<script src="https:\/\/cdn\.tailwindcss\.com">/;
    const loads = (beat: unknown): boolean => tailwindTag.test(beatPreviewDocument(beat, 0, OPTIONS) ?? "");
    assert.equal(loads({ text: "x", image: { type: "html_tailwind", html: '<div class="text-4xl">Hello</div>' } }), true);
    assert.equal(loads({ text: "x", image: { type: "slide", slide: { layout: "title", title: "Deck" } } }), true);
    assert.equal(
      loads({ text: "x", image: { type: "chart", title: "c", chartData: { type: "bar", data: { labels: ["a"], datasets: [{ data: [1] }] } } } }),
      true,
    );
    assert.equal(loads(mermaid), true);
    assert.equal(loads(textSlide), false);
    assert.equal(loads(markdown), false);
    assert.equal(loads({ text: "x", image: { type: "markdown", markdown: ["# T", "```mermaid", "graph TD; A-->B", "```"] } }), true);
  });

  it("leaves image and movie beats on the PNG path, though beatToHtml could draw them", () => {
    const image = { text: "x", image: { type: "image", source: { kind: "url", url: "https://example.com/a.png" } } };
    const movie = { text: "x", image: { type: "movie", source: { kind: "url", url: "https://example.com/clip.mp4" } } };
    assert.equal(beatPreviewDocument(image, 0, OPTIONS), null);
    assert.equal(beatPreviewDocument(movie, 0, OPTIONS), null);
  });

  it("draws an html_tailwind beat with its script field, but leaves elements / animation on the PNG path", () => {
    const html = '<div id="x">Hi</div>';
    const scripted = { text: "x", image: { type: "html_tailwind", html, script: "document.getElementById('x').textContent='Run';" } };
    const doc = beatPreviewDocument(scripted, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /<script>\ndocument\.getElementById\('x'\)\.textContent='Run';\n<\/script>/);
    assert.match(doc, /script-src 'unsafe-inline' https:;/);
    const animated = { text: "x", image: { type: "html_tailwind", html, animation: true } };
    assert.equal(beatPreviewDocument(animated, 0, OPTIONS), null);
  });

  it("leaves a text beat with a background image (its own or the deck's) on the PNG path", () => {
    const withOwn = {
      text: "x",
      image: { type: "textSlide", slide: { title: "T" }, backgroundImage: { type: "image", source: { kind: "url", url: "https://example.com/bg.png" } } },
    };
    assert.equal(beatPreviewDocument(withOwn, 0, OPTIONS), null);
    const deckOptions = previewOptionsOf({ imageParams: { backgroundImage: { type: "image", source: { kind: "url", url: "https://example.com/bg.png" } } } });
    assert.equal(beatPreviewDocument(textSlide, 0, deckOptions), null);
    assert.ok(beatPreviewDocument(textSlide, 0, OPTIONS));
  });

  it("keeps the narrow script sources for beats without an author script", () => {
    const doc = beatPreviewDocument(textSlide, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /script-src 'unsafe-inline' https:\/\/cdn\.tailwindcss\.com https:\/\/cdn\.jsdelivr\.net;/);
  });
});

describe("authorScriptTag", () => {
  it("emits a module script when the code imports or exports, a classic one otherwise", () => {
    assert.equal(authorScriptTag(undefined), "");
    assert.equal(authorScriptTag(""), "");
    assert.equal(authorScriptTag("run();"), "<script>\nrun();\n</script>");
    assert.equal(
      authorScriptTag(["  import x from 'https://esm.sh/x';", "x();"]),
      "<script type=\"module\">\n  import x from 'https://esm.sh/x';\nx();\n</script>",
    );
    assert.match(authorScriptTag("export const a = 1;"), /^<script type="module">/);
  });
});

type ChartConfig = { type: string; data: { datasets: Record<string, unknown>[] }; options?: Record<string, unknown> };

// Runs the driver against one fake canvas and returns the config Chart.js would have received.
function driveChart(config: unknown): ChartConfig {
  const drawn: ChartConfig[] = [];
  const canvas = { dataset: { mulmoChart: JSON.stringify(config) } };
  const fakeDocument = { querySelectorAll: () => [canvas] };
  function FakeChart(_ctx: unknown, chartConfig: ChartConfig): void {
    drawn.push(chartConfig);
  }
  new Function("document", "Chart", "console", CHART_DRIVER_JS)(fakeDocument, FakeChart, console);
  const [first] = drawn;
  assert.ok(first, "the driver drew no chart");
  return first;
}

describe("chart driver", () => {
  it("turns a treemap's colour array into a function cycling through it, as the PNG template does", () => {
    const config = driveChart({ type: "treemap", data: { datasets: [{ tree: [1, 2, 3], backgroundColor: ["red", "blue"] }] } });
    const [dataset] = config.data.datasets;
    assert.ok(dataset);
    const colour = dataset.backgroundColor;
    assert.equal(typeof colour, "function");
    if (typeof colour !== "function") return;
    assert.deepEqual(
      [0, 1, 2].map((dataIndex) => colour({ dataIndex })),
      ["red", "blue", "red"],
    );
  });

  it("turns a sankey's colorFrom / colorTo maps into lookups with a grey fallback", () => {
    const flows = [{ from: "a", to: "b", flow: 1 }];
    const config = driveChart({ type: "sankey", data: { datasets: [{ data: flows, colorFrom: { a: "green" }, colorTo: {} }] } });
    const [dataset] = config.data.datasets;
    assert.ok(dataset);
    const from = dataset.colorFrom;
    const to = dataset.colorTo;
    assert.ok(typeof from === "function" && typeof to === "function");
    if (typeof from !== "function" || typeof to !== "function") return;
    const point = { dataset: { data: flows }, dataIndex: 0 };
    assert.equal(from(point), "green");
    assert.equal(to(point), "#999");
  });

  it("leaves other chart types' colours alone and turns animation off", () => {
    const config = driveChart({ type: "bar", data: { datasets: [{ data: [1], backgroundColor: ["red"] }] } });
    const [dataset] = config.data.datasets;
    assert.ok(dataset);
    assert.deepEqual(dataset.backgroundColor, ["red"]);
    assert.equal(config.options?.animation, false);
  });

  it("keeps the narrow CSP for an html_tailwind beat whose script field is empty", () => {
    const doc = beatPreviewDocument({ text: "x", image: { type: "html_tailwind", html: "<p>x</p>", script: "" } }, 0, OPTIONS);
    assert.ok(doc);
    assert.doesNotMatch(doc, /script-src 'unsafe-inline' https:;/);
  });
});
