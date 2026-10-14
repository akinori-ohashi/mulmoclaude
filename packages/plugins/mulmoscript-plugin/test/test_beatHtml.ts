import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CHART_DRIVER_JS, DEFAULT_CANVAS, beatPreviewDocument, buildBeatHtmlDocument, previewMediaUrl, previewOptionsOf } from "../src/vue/beatHtml.js";

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

  it("puts the white page background on body only, so a background image's ::before is not covered by html", () => {
    const doc = buildBeatHtmlDocument({ html: "<p>x</p>" }, { canvas: DEFAULT_CANVAS, tailwind: false });
    assert.match(doc, /overflow:hidden\}body\{background:#fff\}/);
  });

  it("writes documentCss before the fragment css, and documentScript after the markup", () => {
    const doc = buildBeatHtmlDocument(
      { html: "<p>x</p>", css: ".text{}", documentCss: "body{background-image:none}", documentScript: "<script>run()</script>" },
      { canvas: DEFAULT_CANVAS, tailwind: false },
    );
    assert.match(doc, /body\{background-image:none\}<\/style><style>\.text\{\}/);
    assert.match(doc, /<p>x<\/p><script>run\(\)<\/script>/);
    assert.match(doc, /script-src 'unsafe-inline' https:;/);
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
    assert.equal(loads({ text: "x", image: { type: "markdown", markdown: '# T\r\n\r\n```mermaid title="Flow"\r\ngraph TD; A-->B\r\n```\r\n' } }), true);
  });

  it("leaves image and movie beats on the PNG path, though beatToHtml could draw them", () => {
    const image = { text: "x", image: { type: "image", source: { kind: "url", url: "https://example.com/a.png" } } };
    const movie = { text: "x", image: { type: "movie", source: { kind: "url", url: "https://example.com/clip.mp4" } } };
    assert.equal(beatPreviewDocument(image, 0, OPTIONS), null);
    assert.equal(beatPreviewDocument(movie, 0, OPTIONS), null);
  });

  it("draws an html_tailwind beat with its script after the markup, and widens the script sources for it", () => {
    const html = '<div id="x">Hi</div>';
    const scripted = { text: "x", image: { type: "html_tailwind", html, script: "document.getElementById('x').textContent='Run';" } };
    const doc = beatPreviewDocument(scripted, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /<div id="x">Hi<\/div><script>\ndocument\.getElementById\('x'\)\.textContent='Run';\n<\/script>/);
    assert.match(doc, /script-src 'unsafe-inline' https:;/);
  });

  it("draws an animated html_tailwind beat with mulmocast's runtime, frame state and paused CSS animations", () => {
    const animated = { text: "x", image: { type: "html_tailwind", html: "<div data-mulmo-animate></div>", animation: true } };
    const doc = beatPreviewDocument(animated, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /window\.__MULMO/);
    assert.match(doc, /animation-play-state/);
  });

  it("draws swipe elements with their driver", () => {
    const swipe = { text: "x", image: { type: "html_tailwind", elements: [{ id: "box", text: "x", opacity: 0, to: { opacity: 1, timing: [0, 1] } }] } };
    const doc = beatPreviewDocument(swipe, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /new MulmoAnimation\(\)/);
  });

  const urlBackground = { type: "image", source: { kind: "url", url: "https://example.com/bg.png" } };
  const pathBackground = { type: "image", source: { kind: "path", path: "images/bg.png" } };

  it("paints a text beat's url background (its own or the deck's) behind the page, before the text CSS", () => {
    const own = beatPreviewDocument({ ...textSlide, image: { ...textSlide.image, backgroundImage: urlBackground } }, 0, OPTIONS);
    assert.ok(own);
    assert.match(own, /background-image: url\('https:\/\/example\.com\/bg\.png'\)[\s\S]*font-family: Arial/);
    const deck = beatPreviewDocument(textSlide, 0, previewOptionsOf({ imageParams: { backgroundImage: "https://example.com/bg.png" } }));
    assert.ok(deck);
    assert.match(deck, /url\('https:\/\/example\.com\/bg\.png'\)/);
    assert.doesNotMatch(beatPreviewDocument(textSlide, 0, OPTIONS) ?? "", /background-image/);
  });

  it("paints a base64 background as a data URI, which mulmocast's default resolver would skip", () => {
    const base64Background = { type: "image", source: { kind: "base64", data: "iVBORw0KGgo=" } };
    const doc = beatPreviewDocument({ ...textSlide, image: { ...textSlide.image, backgroundImage: base64Background } }, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /url\('data:image\/png;base64,iVBORw0KGgo='\)/);
  });

  it("paints a chart or mermaid beat's url background", () => {
    const doc = beatPreviewDocument({ ...mermaid, image: { ...mermaid.image, backgroundImage: urlBackground } }, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /https:\/\/example\.com\/bg\.png/);
  });

  it("leaves a beat whose resolved background is a local file on the PNG path", () => {
    assert.equal(beatPreviewDocument({ ...textSlide, image: { ...textSlide.image, backgroundImage: pathBackground } }, 0, OPTIONS), null);
    assert.equal(beatPreviewDocument({ ...mermaid, image: { ...mermaid.image, backgroundImage: pathBackground } }, 0, OPTIONS), null);
    const deckOptions = previewOptionsOf({ imageParams: { backgroundImage: pathBackground } });
    assert.equal(beatPreviewDocument(textSlide, 0, deckOptions), null);
    assert.ok(beatPreviewDocument({ ...textSlide, image: { ...textSlide.image, backgroundImage: null } }, 0, deckOptions));
    assert.ok(beatPreviewDocument({ ...textSlide, image: { ...textSlide.image, backgroundImage: urlBackground } }, 0, deckOptions));
  });

  it("leaves a background or branding the CSP would block (a non-https url) on the PNG path", () => {
    const httpBackground = { type: "image", source: { kind: "url", url: "http://example.com/bg.png" } };
    assert.equal(beatPreviewDocument({ ...textSlide, image: { ...textSlide.image, backgroundImage: httpBackground } }, 0, OPTIONS), null);
    assert.equal(beatPreviewDocument(textSlide, 0, previewOptionsOf({ imageParams: { backgroundImage: "http://example.com/bg.png" } })), null);
    const httpLogo = { logo: { source: { kind: "url", url: "http://example.com/logo.png" } } };
    const slide = { text: "x", image: { type: "slide", slide: { layout: "title", title: "Deck" }, branding: httpLogo } };
    assert.equal(beatPreviewDocument(slide, 0, OPTIONS), null);
    assert.ok(beatPreviewDocument(textSlide, 0, previewOptionsOf({ imageParams: { backgroundImage: "HTTPS://example.com/bg.png" } })));
  });

  it("lets the page load video and audio over https, as an html_tailwind beat's markup may", () => {
    const doc = beatPreviewDocument({ text: "x", image: { type: "html_tailwind", html: '<video src="https://example.com/a.mp4"></video>' } }, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /media-src https: data: blob:/);
  });

  it("leaves a chart or mermaid beat with a named style on the PNG path, as the PNG render applies it", () => {
    assert.equal(beatPreviewDocument({ ...mermaid, image: { ...mermaid.image, style: "github" } }, 0, OPTIONS), null);
  });

  it("reads a deck-level null or malformed background or branding as none", () => {
    const nulls = previewOptionsOf({ imageParams: { backgroundImage: null }, slideParams: { branding: null } });
    assert.equal(nulls.deckBackgroundImage, undefined);
    assert.equal(nulls.deckBranding, undefined);
    assert.ok(beatPreviewDocument(textSlide, 0, nulls));
    const malformed = previewOptionsOf({ imageParams: { backgroundImage: 42 }, slideParams: { branding: { logo: "x" } } });
    assert.equal(malformed.deckBackgroundImage, undefined);
    assert.equal(malformed.deckBranding, undefined);
  });

  it("draws a slide's url branding (its own or the deck's), and leaves a local-file one on the PNG path", () => {
    const slide = { text: "x", image: { type: "slide", slide: { layout: "title", title: "Deck" } } };
    const urlBranding = { logo: { source: { kind: "url", url: "https://example.com/logo.png" } } };
    const pathBranding = { backgroundImage: { source: { kind: "path", path: "images/bg.png" } } };
    const own = beatPreviewDocument({ ...slide, image: { ...slide.image, branding: urlBranding } }, 0, OPTIONS);
    assert.ok(own);
    assert.match(own, /https:\/\/example\.com\/logo\.png/);
    assert.match(beatPreviewDocument(slide, 0, previewOptionsOf({ slideParams: { branding: urlBranding } })) ?? "", /example\.com\/logo\.png/);
    assert.equal(beatPreviewDocument({ ...slide, image: { ...slide.image, branding: pathBranding } }, 0, OPTIONS), null);
    const deckOptions = previewOptionsOf({ slideParams: { branding: pathBranding } });
    assert.equal(beatPreviewDocument(slide, 0, deckOptions), null);
    assert.ok(beatPreviewDocument({ ...slide, image: { ...slide.image, branding: null } }, 0, deckOptions));
  });

  it("keeps the narrow script sources for beats without an author script", () => {
    const doc = beatPreviewDocument(textSlide, 0, OPTIONS);
    assert.ok(doc);
    assert.match(doc, /script-src 'unsafe-inline' https:\/\/cdn\.tailwindcss\.com https:\/\/cdn\.jsdelivr\.net;/);
  });
});

describe("previewMediaUrl", () => {
  it("uses a url as written and turns base64 into a PNG data URI, as the PNG path inlines them", () => {
    assert.equal(previewMediaUrl({ kind: "url", url: "https://example.com/a.png" }), "https://example.com/a.png");
    assert.equal(previewMediaUrl({ kind: "base64", data: "iVBORw0KGgo=" }), "data:image/png;base64,iVBORw0KGgo=");
    assert.equal(previewMediaUrl({ kind: "base64", data: "data:image/jpeg;base64,/9j/" }), "data:image/jpeg;base64,/9j/");
    assert.equal(previewMediaUrl({ kind: "path", path: "images/a.png" }), undefined);
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

  it("draws a figure slide (deck 2.1's layout)", () => {
    const figure = { text: "x", image: { type: "slide", slide: { layout: "figure", title: "Fig", figure: { type: "mermaid", code: "graph TD; A-->B" } } } };
    assert.ok(beatPreviewDocument(figure, 0, OPTIONS));
  });
});
