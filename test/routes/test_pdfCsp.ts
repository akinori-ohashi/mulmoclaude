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

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PDF_ROUTE = readFileSync(path.join(REPO_ROOT, "server/api/routes/pdf.ts"), "utf8");

describe("the plain-markdown PDF document forbids scripts", () => {
  it("wrapHtml emits a Content-Security-Policy", () => {
    assert.match(PDF_ROUTE, /<meta http-equiv="Content-Security-Policy" content="\$\{NO_SCRIPT_CSP\}">/);
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
