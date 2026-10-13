import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CANVAS, beatPreviewDocument, buildBeatHtmlDocument, previewOptionsOf } from "../src/vue/beatHtml.js";

const OPTIONS = { canvas: { ...DEFAULT_CANVAS } };

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
      DEFAULT_CANVAS,
    );
    assert.match(doc, /npm\/chart\.js/);
    assert.match(doc, /chartjs-chart-sankey/);
    assert.doesNotMatch(buildBeatHtmlDocument({ html: "<p>x</p>" }, DEFAULT_CANVAS), /npm\/chart\.js/);
  });

  it("lays the page out at the canvas size and includes the fragment's own css", () => {
    const doc = buildBeatHtmlDocument({ html: "<p>x</p>", css: ".scoped{color:red}" }, { width: 1080, height: 1920 });
    assert.match(doc, /width:1080px;height:1920px/);
    assert.match(doc, /\.scoped\{color:red\}/);
  });
});

describe("previewOptionsOf", () => {
  it("defaults to the 1280x720 canvas and no theme", () => {
    assert.deepEqual(previewOptionsOf({}), { canvas: { width: 1280, height: 720 }, slideTheme: undefined });
    assert.deepEqual(previewOptionsOf(null).canvas, { width: 1280, height: 720 });
  });

  it("reads the script's canvas size", () => {
    assert.deepEqual(previewOptionsOf({ canvasSize: { width: 1080, height: 1920 } }).canvas, { width: 1080, height: 1920 });
  });

  it("ignores a malformed canvas size", () => {
    assert.deepEqual(previewOptionsOf({ canvasSize: { width: "wide" } }).canvas, { width: 1280, height: 720 });
  });
});
