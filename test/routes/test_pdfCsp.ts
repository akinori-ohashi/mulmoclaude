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
    ["script-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].forEach((directive) => {
      assert.ok(policy.includes(directive), `missing ${directive}`);
    });
  });
});

describe("the Marp document is exempt, and here is the assumption that makes it safe", () => {
  it("Marp ESCAPES author raw HTML instead of rendering it", async () => {
    // This is the whole reason the Marp document may keep JavaScript
    // enabled for its own polyfill. A Marp upgrade that starts passing
    // raw HTML through turns this red.
    const deck = ["---", "marp: true", "---", "", "# Slide", "", "<script>window.EVIL=1</script>", "", "after"].join("\n");
    const { html } = await renderMarpDeck(deck, { themes: [], inlineSVG: true });
    assert.match(html, /&lt;script&gt;/, "Marp must escape author script tags");
    assert.doesNotMatch(html, /<script[^>]*>\s*window\.EVIL/, "an author script must never become executable markup");
  });

  it("Marp ships exactly one script of its own, which is why it is not blanket-blocked", async () => {
    const deck = ["---", "marp: true", "---", "", "# Slide"].join("\n");
    const { html } = await renderMarpDeck(deck, { themes: [], inlineSVG: true });
    const scripts = [...html.matchAll(/<script[^>]*>/gi)];
    assert.equal(scripts.length, 1, "if Marp stops needing its polyfill, the Marp document should get the CSP too");
  });
});
