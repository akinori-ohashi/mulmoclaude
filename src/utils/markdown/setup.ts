// One-time marked configuration for the SPA. Call `setupMarked()`
// from `src/main.ts` before the Vue app mounts so every component
// that imports `{ marked }` afterwards inherits the configured
// global instance.
//
// Today this installs the wiki-embed extension, the built-in
// `amazon` / `isbn` handlers (#1221 PR-B), and highlight.js syntax
// highlighting for fenced code blocks (#1868). Future global marked
// extensions belong here too — keep all the side-effects in one
// greppable spot.

import { unref } from "vue";
import { marked } from "marked";
// highlight.js theme: token classes are language-agnostic, so this one
// stylesheet colours every language `markedHighlightExtension` emits.
import "highlight.js/styles/github.css";
import i18n from "../../lib/vue-i18n";
import { wikiEmbedExtension } from "./wikiEmbeds";
import { registerBuiltInWikiEmbeds, setEmbedLocaleProvider } from "./wikiEmbedHandlers";
import { workspaceLinkifyExtension } from "./workspaceLinkify";
import { markedHighlightExtension } from "./highlight";
import { mermaidExtension } from "@mulmoclaude/markdown-utils/markdown/mermaidExtension";
import { codeCopyExtension, setCodeCopyLabelProvider, type CodeCopyLabels } from "@mulmoclaude/markdown-utils/markdown/codeCopyExtension";
import { installCodeCopyHandler } from "@mulmoclaude/markdown-utils/markdown/codeCopyClipboard";
import { rawHtmlPolicyExtension } from "@mulmoclaude/markdown-utils/markdown/rawHtmlPolicy";

let installed = false;

const codeCopyLabels = (): CodeCopyLabels => ({
  copy: i18n.global.t("markdownCodeCopy.copyLabel"),
  copied: i18n.global.t("markdownCodeCopy.copiedLabel"),
});

export function setupMarked(): void {
  // Idempotent: tests reach for `setupMarked()` before each
  // assertion suite without paying for re-installation.
  if (installed) return;
  // Wire the live i18n locale into the Amazon-storefront resolver
  // BEFORE registering handlers; the handlers themselves only call
  // the provider at render time, but doing it here keeps boot order
  // discoverable.
  setEmbedLocaleProvider(() => String(unref(i18n.global.locale)));
  registerBuiltInWikiEmbeds();
  marked.use(wikiEmbedExtension);
  // Fallback for the LLM-output residue where a generated file gets
  // emitted as an inline-code span instead of a Markdown link. See
  // `workspaceLinkify.ts` for the detection contract (#1300).
  marked.use(workspaceLinkifyExtension);
  // Author-supplied raw HTML may carry neither `class` nor `style`: this
  // app ships utility CSS, so both spell an overlay that hides what a code
  // block really says while the copy button takes the hidden text (#3151).
  // Only raw HTML goes through marked's `html` renderer, so markup from
  // another RENDERER keeps its classes. Markup injected into the markdown
  // SOURCE does not get that for free — it arrives here as author HTML — and
  // must prove itself with `withTrustedAppMarkup`, as the wiki pipeline does.
  marked.use(rawHtmlPolicyExtension);
  marked.use(markedHighlightExtension);
  // Reading the labels through a provider — rather than passing today's
  // strings — is what keeps them live: `t()` reads the reactive locale,
  // the read happens while a viewer's `renderedHtml` computed evaluates,
  // and Vue therefore re-renders the buttons on a language switch.
  setCodeCopyLabelProvider(codeCopyLabels);
  // Copy buttons are a `code` renderer override too, and must land AFTER
  // highlight for the same reason mermaid does: highlight's `walkTokens`
  // has by then rewritten `token.text` into highlighted html, which this
  // renderer emits inside its own wrapper.
  marked.use(codeCopyExtension);
  // Mermaid is a `code` renderer override, so it must land AFTER
  // highlight — later `.use()` calls wrap earlier ones, and returning
  // `false` from our override falls through to the renderer underneath.
  // Registering it LAST makes it outermost, so: `mermaid` fence →
  // placeholder, untouched by the copy wrapper; any other fence → falls
  // through to the copy wrapper around highlight.js output.
  marked.use(mermaidExtension);
  // One delegated listener for every copy button the extension emits,
  // now and after each streamed re-render. Idempotent, so the markdown
  // plugin's own install is a no-op on this document — which is exactly
  // why it takes no labels: whichever bundle installs first would
  // otherwise caption the other one's buttons. Each button carries its
  // own two label states instead.
  installCodeCopyHandler(document);
  installed = true;
}
