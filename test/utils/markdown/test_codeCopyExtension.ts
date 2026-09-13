// Pure marked → HTML tests for the code-copy renderer extension.
// Browser-free: the markup contract is a string, and the click side of
// the feature is covered separately in `test_codeCopyClipboard.ts`.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import {
  codeCopyExtension,
  setCodeCopyLabelProvider,
  _resetCodeCopyLabelsForTests,
  CODE_COPY_ATTR,
  CODE_COPY_BLOCK_ATTR,
} from "@mulmoclaude/markdown-utils/markdown/codeCopyExtension";
import { mermaidExtension } from "@mulmoclaude/markdown-utils/markdown/mermaidExtension";
import { JSDOM } from "jsdom";
import { markedHighlightExtension } from "../../../src/utils/markdown/highlight";

// `dompurify` reads `window` at module load and tests run in Node, so JSDOM
// has to be in the globals before the sanitizer is imported — hence the
// dynamic import, same dance as `test_sanitizeCoreMarkdownHtml.ts`. A static
// import here loads dompurify during hoisting and it degrades to a stub.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as { window?: unknown; document?: unknown }).window = dom.window;
(globalThis as { window?: unknown; document?: unknown }).document = dom.window.document;

const { sanitizeMarkdownHtml } = await import("@mulmoclaude/core/plugin-vue");

/** Mirrors `setupMarked()`'s order exactly: highlight, then copy, then
 *  mermaid outermost. The order is the contract — a mermaid fence must
 *  never reach the copy wrapper — so the tests exercise the real chain
 *  rather than the extension in isolation. */
function markedLikeHost(): Marked {
  const instance = new Marked();
  instance.use(markedHighlightExtension);
  instance.use(codeCopyExtension);
  instance.use(mermaidExtension);
  return instance;
}

/** The plugin's chain: no highlight, so `token.text` arrives raw and
 *  unescaped and the extension has to escape it itself. */
function markedLikePlugin(): Marked {
  const instance = new Marked();
  instance.use(codeCopyExtension);
  instance.use(mermaidExtension);
  return instance;
}

afterEach(() => _resetCodeCopyLabelsForTests());

describe("codeCopyExtension", () => {
  it("wraps a fenced block with a copy button and keeps the highlight class shape", () => {
    const html = markedLikeHost().parse("```ts\nconst a = 1;\n```") as string;
    assert.match(html, new RegExp(`<div class="relative" ${CODE_COPY_BLOCK_ATTR}>`));
    assert.match(html, new RegExp(`<button type="button" ${CODE_COPY_ATTR} `));
    assert.match(html, /<pre><code class="hljs language-ts">/);
  });

  it("uses the bare hljs class for an untagged fence, matching emptyLangClass", () => {
    const html = markedLikeHost().parse("```\nplain\n```") as string;
    assert.match(html, /<code class="hljs">/);
    assert.doesNotMatch(html, /language-/);
  });

  it("leaves a mermaid fence untouched — mermaid is outermost", () => {
    const html = markedLikeHost().parse("```mermaid\ngraph TD;\nA-->B;\n```") as string;
    assert.match(html, /<pre class="mermaid" data-mermaid-pending="1">/);
    assert.doesNotMatch(html, new RegExp(CODE_COPY_ATTR));
  });

  it("leaves inline code untouched", () => {
    const html = markedLikeHost().parse("some `inline` code") as string;
    assert.match(html, /<code>inline<\/code>/);
    assert.doesNotMatch(html, new RegExp(CODE_COPY_ATTR));
  });

  it("does not double-escape highlight's already-escaped output", () => {
    const html = markedLikeHost().parse('```js\nconst s = "x";\n```') as string;
    assert.match(html, /&quot;x&quot;/);
    assert.doesNotMatch(html, /&amp;quot;/);
  });

  it("escapes the body itself when no highlighter ran (the plugin's chain)", () => {
    const html = markedLikePlugin().parse("```\n<script>alert(1)</script>\n```") as string;
    assert.ok(html.includes("&lt;script&gt;"));
    // Substring on a lower-cased copy, not a `/<script>/` regex: the
    // regex form asserts less than it looks like it does (it misses
    // `<SCRIPT>`), which is what CodeQL's js/bad-tag-filter is for.
    assert.ok(!html.toLowerCase().includes("<script"));
  });

  it("drops a fence tag that is not a plain language word", () => {
    const html = markedLikePlugin().parse('```ts"><img src=x onerror=alert(1)>\ncode\n```') as string;
    assert.match(html, /<code class="hljs">/);
    assert.doesNotMatch(html, /onerror/);
  });

  it("takes only the first word of a fence tag with metadata", () => {
    const html = markedLikePlugin().parse("```ts title=foo.ts\ncode\n```") as string;
    assert.match(html, /<code class="hljs language-ts">/);
  });

  it("renders the provider's labels and escapes them", () => {
    setCodeCopyLabelProvider(() => ({ copy: 'Copy "code"', copied: "Copied" }));
    const html = markedLikePlugin().parse("```\nx\n```") as string;
    assert.match(html, /aria-label="Copy &quot;code&quot;"/);
    assert.match(html, /title="Copy &quot;code&quot;"/);
  });

  it("re-reads the provider on every render, so a locale switch takes effect", () => {
    let locale = "en";
    setCodeCopyLabelProvider(() => (locale === "en" ? { copy: "Copy code", copied: "Copied" } : { copy: "コードをコピー", copied: "コピーしました" }));
    const instance = markedLikePlugin();
    assert.match(instance.parse("```\nx\n```") as string, /aria-label="Copy code"/);
    locale = "ja";
    assert.match(instance.parse("```\nx\n```") as string, /aria-label="コードをコピー"/);
  });

  it("survives the sanitizer every markdown surface runs it through", () => {
    const html = sanitizeMarkdownHtml(markedLikeHost().parse("```ts\nconst a = 1;\n```") as string);
    assert.match(html, new RegExp(CODE_COPY_BLOCK_ATTR));
    assert.match(html, new RegExp(CODE_COPY_ATTR));
    assert.match(html, /<button/);
    assert.match(html, /<svg/);
    assert.match(html, /aria-label="Copy code"/);
  });
});
