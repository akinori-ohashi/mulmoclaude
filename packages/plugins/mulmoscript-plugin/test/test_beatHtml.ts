import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CANVAS, beatPreviewDocument, buildBeatHtmlDocument, previewOptionsOf } from "../src/vue/beatHtml.js";

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

  it("loads Tailwind only for html_tailwind beats, whose markup is written against it", () => {
    const htmlTailwind = { text: "x", image: { type: "html_tailwind", html: '<div class="text-4xl">Hello</div>' } };
    const tailwindDoc = beatPreviewDocument(htmlTailwind, 0, OPTIONS);
    assert.ok(tailwindDoc);
    assert.match(tailwindDoc, /<script src="https:\/\/cdn\.tailwindcss\.com">/);
    const textDoc = beatPreviewDocument(textSlide, 0, OPTIONS);
    assert.ok(textDoc);
    assert.doesNotMatch(textDoc, /<script src="https:\/\/cdn\.tailwindcss\.com">/);
  });
});
