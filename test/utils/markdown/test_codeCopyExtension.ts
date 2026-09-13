// Pure marked → HTML tests for the code-copy renderer extension.
// Browser-free: the markup contract is a string, and the click side of
// the feature is covered separately in `test_codeCopyClipboard.ts`.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import {
  codeCopyExtension,
  createCodeCopyNonce,
  CODE_COPY_NONCE_UNAVAILABLE,
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

describe("createCodeCopyNonce", () => {
  // These pin SECRECY, not just non-emptiness. Codex named the mutation
  // that proved the gap: `createCodeCopyNonce() { return "fixed-public-nonce" }`
  // passed all 41 tests — and in an open-source repo a fixed literal is
  // one an attacker reads off GitHub and pastes into their markdown.
  const realCrypto = globalThis.crypto;
  const setCrypto = (value: unknown): void => {
    Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
  };
  afterEach(() => setCrypto(realCrypto));

  it("returns a different value every call — the whole point of a nonce", () => {
    const seen = new Set(Array.from({ length: 32 }, () => createCodeCopyNonce()));
    assert.equal(seen.size, 32);
    assert.ok(!seen.has(CODE_COPY_NONCE_UNAVAILABLE));
  });

  it("prefers randomUUID when the platform has it", () => {
    setCrypto({ randomUUID: () => "uuid-from-the-platform" });
    assert.equal(createCodeCopyNonce(), "uuid-from-the-platform");
  });

  it("falls back to getRandomValues, hex-encoded", () => {
    setCrypto({
      getRandomValues: (array: Uint8Array) => {
        array.fill(0xab);
        return array;
      },
    });
    assert.equal(createCodeCopyNonce(), "ab".repeat(16));
  });

  it("returns the unavailable sentinel when there is no CSPRNG — never a weak one", () => {
    // Fail closed. `Math.random` is not a fallback here; it is a weaker
    // version of the thing being defended.
    setCrypto(undefined);
    assert.equal(createCodeCopyNonce(), CODE_COPY_NONCE_UNAVAILABLE);
    setCrypto({});
    assert.equal(createCodeCopyNonce(), CODE_COPY_NONCE_UNAVAILABLE);
  });
});

describe("codeCopyExtension", () => {
  it("wraps a fenced block with a copy button and keeps the highlight class shape", () => {
    const html = markedLikeHost().parse("```ts\nconst a = 1;\n```") as string;
    assert.match(html, new RegExp(`<div class="relative" ${CODE_COPY_BLOCK_ATTR}="fenced">`));
    // The marker carries a nonce as its VALUE — a bare marker is precisely
    // what author markup can forge, so it must never be empty.
    const marker = html.match(new RegExp(`${CODE_COPY_ATTR}="([^"]*)"`));
    assert.ok(marker);
    assert.notEqual(marker[1], "", "an empty nonce is refused by the listener, leaving the button inert");
    assert.match(html, /<pre dir="ltr"><code class="hljs language-ts">/);
  });

  it("isolates the block from an author's text direction", () => {
    // An author `dir="rtl"` wrapper right-aligns the block and scrolls a
    // long line's LEFT end — where a payload would sit — out of view,
    // while the clipboard still takes the whole logical string. Isolating
    // the block keeps legitimate RTL prose working around it.
    const html = markedLikeHost().parse("```ts\nconst a = 1;\n```") as string;
    assert.match(html, /<pre dir="ltr">/);
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

  it("gives an indented code block a button too — deliberately, and marks the style", () => {
    // marked renders a 4-space block as the same `<pre><code>` a fence
    // produces, so a reader has the same reason to copy it. Skipping it
    // would make the affordance appear and vanish for no visible reason.
    // The style is recorded because the two copy differently: only the
    // indented one carries a trailing newline nobody wrote.
    const html = markedLikeHost().parse("paragraph\n\n    indented();\n") as string;
    assert.match(html, new RegExp(CODE_COPY_ATTR));
    assert.match(html, /<code class="hljs">/);
    assert.match(html, new RegExp(`${CODE_COPY_BLOCK_ATTR}="indented"`));
  });

  it("marks a fenced block as fenced, whatever its tag", () => {
    const tagged = markedLikeHost().parse("```ts\nx\n```") as string;
    const bare = markedLikeHost().parse("```\nx\n```") as string;
    assert.match(tagged, new RegExp(`${CODE_COPY_BLOCK_ATTR}="fenced"`));
    assert.match(bare, new RegExp(`${CODE_COPY_BLOCK_ATTR}="fenced"`));
  });

  it("renders the provider's labels and escapes them", () => {
    setCodeCopyLabelProvider(() => ({ copy: 'Copy "code"', copied: "Copied" }));
    const html = markedLikePlugin().parse("```\nx\n```") as string;
    assert.match(html, /aria-label="Copy &quot;code&quot;"/);
    assert.match(html, /title="Copy &quot;code&quot;"/);
  });

  it("writes BOTH label states into the button", () => {
    // The delegated listener reads them from here rather than from a
    // provider of its own: only the first install on a document keeps
    // its listener, so a captured provider would caption the other
    // bundle's buttons too.
    setCodeCopyLabelProvider(() => ({ copy: "コードをコピー", copied: "コピーしました" }));
    const html = markedLikePlugin().parse("```\nx\n```") as string;
    assert.match(html, /data-code-copy-idle="コードをコピー"/);
    assert.match(html, /data-code-copy-copied="コピーしました"/);
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
