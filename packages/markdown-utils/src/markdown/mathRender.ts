// Runtime side of the math pipeline: scans the DOM for the
// `[data-math-pending]` placeholders written by `mathExtension.ts`,
// lazy-loads MathJax on the first hit, typesets each formula to SVG,
// and swaps the placeholder in place with the resulting `<svg>`.
//
// Mirrors `mermaidRender.ts` deliberately — same lazy-load-and-memoise
// shape, same "replace the node so a second pass finds nothing"
// idempotence, same localised error box carrying the source that broke.
//
// Lazy-load: `mathjax-full`'s TeX→SVG pipeline is heavy (~1 MB). The
// dynamic import keeps it out of the initial bundle for the documents —
// most of them — that contain no math at all.
//
// SVG, not CommonHTML: the output is a self-contained `<svg>` drawn in
// `currentColor`, so it needs no stylesheet and no webfont files in the
// published tarball, and it inherits the surrounding theme's text
// colour for free.
//
// SANITISATION. This SVG is injected AFTER `sanitizeMarkdownHtml` has
// run on the markdown, so DOMPurify never sees it on that pass — and
// MathJax's TeX input is NOT inert: the `html` package (part of
// `AllPackages`) implements `\href`, and `$\href{javascript:alert(1)}{x}$`
// emits a real `<a href="javascript:…">` inside the SVG. A
// `presentDocument` path can open any `.md` on disk, including one that
// came with a cloned repository, so that is a live XSS vector and not a
// theoretical one. Every formula therefore goes through DOMPurify here,
// on its way in.
//
// `fontCache: "none"` is load-bearing for that, not a size preference.
// The default (`"local"`) emits each glyph once into a `<defs>` block
// and references it with `<use xlink:href="#…">` — and DOMPurify drops
// every `<use>` element, which would leave a formula with correct
// geometry and no glyphs at all. `"none"` inlines each glyph as its own
// `<path>`, so nothing depends on an element the sanitiser removes.
// Measured cost: ~5% more markup per formula.
//
// ACCESSIBILITY. MathJax's SVG carries `role="img"` and no accessible
// name, so a screen reader meets an unlabelled graphic where the formula
// is. `AssistiveMmlHandler` fixes that at the source: it marks the SVG
// `aria-hidden="true"` and emits a MathML copy of the same expression
// beside it, which assistive technology reads as maths rather than as a
// picture or as raw LaTeX. That copy is visually hidden here with inline
// styles rather than a class — this module ships no stylesheet and is
// consumed by more than one host, so a host that never adopted our CSS
// would otherwise render every formula twice.
//
// Sanitising rather than trimming the TeX package list is deliberate.
// A package allow-list has to be re-audited every time MathJax adds an
// extension; the sanitiser is a boundary that holds regardless, and it
// keeps a legitimate `\href{https://…}` working while dropping the
// `javascript:` one.
//
// A HOST MAY NEED A STRICTER POLICY THAN THE DEFAULT, which is why
// `renderMathNodes` takes an extra pass. `sanitizeMathSvg` runs DOMPurify with
// its defaults, and those keep `class` and `style` — while the TeX `html`
// package puts BOTH under the author's control:
//
//   $\style{position:fixed;inset:0;background:#fff}{x}$  →  <g style="position: fixed; …">
//   $\class{fixed inset-0 bg-white}{x}$                  →  <g class=" fixed inset-0 bg-white">
//
// Inside an `<svg>` those declarations are largely inert — CSS box
// positioning does not apply to SVG child elements, and the root `<svg>`
// clips its own overflow — so this is not a hole in THIS app, where the
// markdown is a file on the user's own disk. It is a hole in the
// invariant of a host that renders STRANGER-WRITTEN markdown on a
// signed-in origin and has therefore banned author-controlled `class` /
// `style` outright (mulmoserver's article renderer bans both precisely
// because a utility-CSS framework turns a class name into positioning).
// Such a host passes its own function.
//
// That function runs BETWEEN two `sanitizeMathSvg` passes, never instead of one.
// The baseline is not a default a caller can decline: a host writing the targeted
// transformer this feature exists for — strip `class` and `style`, keep the rest —
// would otherwise silently re-admit the `\href{javascript:…}` the baseline is
// there to stop (codex, #2983). And the pass AFTER it is what makes the return
// type honest: a hardener hands back an arbitrary STRING, so nothing in the type
// says it only removed things, and the markup it returns is what reaches the
// document (coderabbit, #2983). Sanitising on both sides is what makes "may only
// tighten" a property of the code rather than a sentence in a docstring — the
// cost is one more DOMPurify pass per formula, against a MathJax typeset.

import DOMPurify from "dompurify";
import { parseMarkupBody } from "../dom/adoptSvg.js";

/** Localised strings the render pipeline surfaces when it fails.
 *  Callers (composables) resolve the keys at component-setup time and
 *  hand the formatter down. Fallback defaults keep the pure module
 *  testable without a Vue / i18n runtime. */
export interface MathRenderLabels {
  loadFailed: (error: string) => string;
  renderFailed: (error: string) => string;
}

const DEFAULT_LABELS: MathRenderLabels = {
  loadFailed: (error) => `⚠ MathJax failed to load: ${error}`,
  renderFailed: (error) => `⚠ Math render failed: ${error}`,
};

/** The one thing the DOM pass needs from `mathjax-full`. Narrow on
 *  purpose: `mathjax-full` is CJS-with-`.d.ts` and has no `exports`
 *  map, so its deep-path types resolve inconsistently between the
 *  plugin's bundler and the host's — keeping the boundary to a single
 *  `string → string` function keeps that out of every caller. */
interface MathTypesetter {
  /** TeX source → `<mjx-container>…<svg>…` markup, sanitised, handed to
   *  `harden`, and sanitised again before it is handed back. The extra
   *  pass is an argument rather than a build-time option
   *  because the typesetter is memoised for the whole page (see
   *  `loadTypesetter`) while two callers on that page may hold different
   *  policies. */
  render: (tex: string, display: boolean, harden: MathHardener) => string;
}

/** A host's EXTRA pass over one formula's markup, run between two
 *  `sanitizeMathSvg` passes and never in place of one. Receives what the
 *  baseline left (`<mjx-container>` wrapping the `<svg>`, plus the
 *  assistive `<math>` twin) and returns a narrower version of it — what
 *  it returns is sanitised again on the way out, so a hardener can only
 *  ever take things away.
 *
 *  Two things it must keep, or the formula degrades: the `<svg>` element
 *  itself (`adoptFormula` returns null without it, and the placeholder
 *  becomes an error box), and — for inline math to sit on the text
 *  baseline — the root `<svg>`'s own `style="vertical-align: …"`. A
 *  policy that strips `style` everywhere still renders; the formula just
 *  sits slightly high. */
export type MathHardener = (markup: string) => string;

/** DOMPurify pass over one formula's SVG. See the SANITISATION note at
 *  the top of the file: this is the only thing standing between a
 *  `\href{javascript:…}` in an arbitrary `.md` and a clickable payload
 *  in the app's origin, because the markdown-level sanitiser has
 *  already run by the time this markup exists. */
export function sanitizeMathSvg(markup: string): string {
  return DOMPurify.sanitize(markup);
}

let typesetterPromise: Promise<MathTypesetter> | null = null;

/** The MathJax pieces this module needs, imported on demand. The return
 *  type is inferred on purpose: annotating it would mean naming
 *  `mathjax-full`'s deep-path types, which is exactly what the
 *  `MathTypesetter` note above explains this module avoids — and an
 *  alias referring back to this function is circular, which resolves to
 *  `any` and silently unchecks every call below. */
async function loadMathJax() {
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }, { LiteElement }, { AssistiveMmlHandler }] =
    await Promise.all([
      import("mathjax-full/js/mathjax.js"),
      import("mathjax-full/js/input/tex.js"),
      import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/liteAdaptor.js"),
      import("mathjax-full/js/handlers/html.js"),
      import("mathjax-full/js/input/tex/AllPackages.js"),
      import("mathjax-full/js/adaptors/lite/Element.js"),
      import("mathjax-full/js/a11y/assistive-mml.js"),
    ]);
  return { mathjax, TeX, SVG, liteAdaptor, RegisterHTMLHandler, AllPackages, LiteElement, AssistiveMmlHandler };
}

/** Build the one-shot TeX→SVG renderer.
 *
 *  `RegisterHTMLHandler` mutates a MathJax-global handler list, so it
 *  must run exactly once per page — memoising the whole builder in
 *  `typesetterPromise` is what guarantees that. `AssistiveMmlHandler`
 *  wraps that handler so every formula also carries a MathML copy of
 *  itself; see the ACCESSIBILITY note at the top of the file.
 *
 *  `doc` and `adaptor` stay captured in the closure rather than being
 *  handed back, so both calls keep the concrete types their imports
 *  gave them and nothing downstream has to assert a node shape.
 *  `AbstractMathDocument.convert` is nonetheless declared `any`, hence
 *  the real `instanceof` narrowing against the lite adaptor's own node
 *  class. */
async function buildTypesetter(): Promise<MathTypesetter> {
  const { mathjax, TeX, SVG, liteAdaptor, RegisterHTMLHandler, AllPackages, LiteElement, AssistiveMmlHandler } = await loadMathJax();
  const adaptor = liteAdaptor();
  AssistiveMmlHandler(RegisterHTMLHandler(adaptor));
  const doc = mathjax.document("", {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG({ fontCache: "none" }),
  });
  return {
    render: (tex, display, harden) => {
      const node: unknown = doc.convert(tex, { display });
      if (!(node instanceof LiteElement)) throw new Error("MathJax returned an unexpected node type");
      // Baseline, host policy, baseline. Never the host policy alone.
      return sanitizeMathSvg(harden(sanitizeMathSvg(adaptor.outerHTML(node))));
    },
  };
}

async function loadTypesetter(): Promise<MathTypesetter> {
  if (typesetterPromise) return typesetterPromise;
  const attempt = buildTypesetter();
  // Share the in-flight promise with parallel callers, but drop the
  // cache once it rejects so a transient failure (offline / stale chunk
  // after a deploy / ad-blocker hiccup) can be retried by the next
  // formula to render. Without this reset the module would be dead
  // until the user reloaded.
  attempt.catch(() => {
    if (typesetterPromise === attempt) typesetterPromise = null;
  });
  typesetterPromise = attempt;
  return attempt;
}

// Visually hidden, still in the accessibility tree. The clip-rect idiom
// rather than `display:none` / `visibility:hidden`, both of which remove
// the node from that tree — which would defeat the whole point.
const VISUALLY_HIDDEN =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;";

/** Split one formula's sanitised markup into the picture and its
 *  screen-reader counterpart, both imported into the live document.
 *  `mathml` is null when MathJax produced no assistive copy. */
export function adoptFormula(markup: string): { svg: SVGElement; mathml: Element | null } | null {
  const parsed = parseMarkupBody(markup);
  const svg = parsed.querySelector("svg");
  if (!svg) return null;
  const math = parsed.querySelector("math");
  return {
    svg: document.importNode(svg, true),
    mathml: math === null ? null : document.importNode(math, true),
  };
}

function hiddenMathml(mathml: Element): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "math-a11y";
  wrapper.setAttribute("style", VISUALLY_HIDDEN);
  wrapper.appendChild(mathml);
  return wrapper;
}

function errorBox(message: string, className: string): HTMLElement {
  const box = document.createElement("code");
  box.className = className;
  box.textContent = message;
  return box;
}

function placeLoadError(nodes: HTMLElement[], err: unknown, labels: MathRenderLabels): void {
  const message = labels.loadFailed(String(err));
  for (const node of nodes) {
    node.replaceWith(errorBox(message, "math-error"));
  }
}

function pendingNodes(root: Element | Document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-math-pending]"));
}

function renderOne(node: HTMLElement, typesetter: MathTypesetter, labels: MathRenderLabels, harden: MathHardener): void {
  // `textContent` gives us the raw TeX — we escaped it going in and
  // DOMPurify preserves text verbatim, so entity decoding is
  // browser-native from the DOM read.
  const source = node.textContent ?? "";
  const display = node.dataset.mathDisplay === "1";
  try {
    const formula = adoptFormula(typesetter.render(source, display, harden));
    if (!formula) throw new Error("MathJax produced malformed SVG");
    // Keep the placeholder's own element (a `<div>` for block math, a
    // `<span>` inside a paragraph for inline) so the surrounding flow
    // is unchanged — only its contents and the pending flag change.
    node.replaceChildren(formula.svg);
    if (formula.mathml) node.appendChild(hiddenMathml(formula.mathml));
    delete node.dataset.mathPending;
  } catch (err) {
    // Preserve the source next to the localised header so the author
    // can see WHICH formula broke.
    node.replaceWith(errorBox(`${labels.renderFailed(String(err))} — ${source}`, "math-error"));
  }
}

/** Typeset every unprocessed math placeholder under `root`. Safe to
 *  call repeatedly — a rendered node loses `data-math-pending` and a
 *  failed one is replaced by an `.math-error` box, so neither matches
 *  a second time. `labels` defaults to English fallbacks so the pure
 *  module remains callable from tests / node environments without an
 *  i18n runtime. `harden` is an EXTRA pass over each formula's markup,
 *  run between two `sanitizeMathSvg` passes rather than instead of one,
 *  so it can only ever narrow what reaches the page (see the HOST note
 *  at the top of the file); it defaults to leaving the sanitised markup
 *  alone. */
export async function renderMathNodes(
  root: Element | Document | null | undefined,
  labels: MathRenderLabels = DEFAULT_LABELS,
  harden: MathHardener = (markup) => markup,
): Promise<void> {
  if (!root) return;
  const nodes = pendingNodes(root);
  if (nodes.length === 0) return;
  let typesetter: MathTypesetter;
  try {
    typesetter = await loadTypesetter();
  } catch (err) {
    // The dynamic import failed (network / bundler / adblock). Swap
    // every pending placeholder for a visible error box so the user
    // sees WHY the formula is missing instead of raw TeX, and don't let
    // the rejection escape as an unhandled promise (callers fire this
    // via `void run()` in the composable).
    placeLoadError(nodes, err, labels);
    return;
  }
  for (const node of nodes) renderOne(node, typesetter, labels, harden);
}
