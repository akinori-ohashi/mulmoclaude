# feat: draw HTML-capable MulmoScript beats in the browser with beatToHtml (#3472)

## Problem

The MulmoScript view (`@mulmoclaude/mulmoscript-plugin`) renders every `textSlide` / `markdown` / `chart` /
`mermaid` / `html_tailwind` / `slide` beat through the server's `renderBeat`, which starts headless Chrome
(`generateBeatImage`) per beat — on every deck open (`AUTO_RENDER_TYPES`). Slow, fails where Chrome is missing, and
(via `ffmpegGuard`, tracked separately in #3475) where ffmpeg is missing. mulmocast's browser entry already has
`beatToHtml`, which the view does not use.

## Decisions (maintainer: recommended options)

1. **Preview**: a beat `beatToHtml` can render is always shown as HTML in the list and the lightbox. Those beats are
   no longer probed for / auto-rendered to PNG. PNGs are made only by the operations that need them (movie / PDF
   export render their own). A beat `beatToHtml` returns `undefined` for (or throws on) falls back to the old PNG
   path unchanged. The script is the source of truth, so an edited beat never shows a stale PNG.
2. **Isolation**: every fragment goes into its own `sandbox="allow-scripts"` iframe (`srcdoc`, no
   `allow-same-origin`) carrying a CSP meta. The fragment is not sanitized by mulmocast and `html_tailwind` carries
   author HTML, so it must not touch the host DOM; the iframe also gives the same rendering inside MulmoTerminal's
   shadow root, and lets the page load the runtimes (`cdn.tailwindcss.com`, Chart.js, mermaid@10 from jsdelivr) the
   way mulmocast's own `actions/html.js` page does, plus `slideUtilityCss` from `@mulmocast/deck`.
3. `ffmpegGuard` in `renderBeat` → separate issue #3475.
4. Same look in MulmoClaude and MulmoTerminal: both use this package; the iframe makes it host-independent.

## Shape

- `src/vue/beatHtml.ts` — pure, browser-safe:
  - `previewOptionsOf(script)` — canvas size (`canvasSize`, default 1280×720), deck slide theme, and the script's
    `textSlideParams`, all validated with mulmocast's own schemas.
  - `beatPreviewDocument(beat, index, options)` → the full `srcdoc` string, or `null` when the beat fails
    `mulmoBeatSchema` or `beatToHtml` cannot render it.
  - `buildBeatHtmlDocument(fragment, { canvas, tailwind })` — page assembly: CSP meta; Chart.js + plugins + a chart
    driver (deck's, which is not exported) when `requires` asks; mermaid@10 + its theme; `slideUtilityCss`; the
    fragment's own `css`.
  - textSlide / markdown come back bare from `beatToHtml`; they get the CSS the PNG path applies (named markdown
    style, else `getTextSlideStyle` — defaults + deck/beat `textSlideParams.cssStyles` — and the vertical centring
    of a bullet-less textSlide).
  - Tailwind is loaded only for `html_tailwind`: its preflight would reset the text-slide CSS, and the PNG path does
    not load it for the other types either.
- `src/vue/components/BeatHtmlFrame.vue`: lays the iframe out at the canvas size (so `100vh` means what it does in
  the PNG render) and scales it to its box with a `ResizeObserver`.
- `View.vue` / `BeatLightbox.vue`: show the frame when a document exists; skip the PNG probe / auto-render /
  generate / ↺ buttons for those beats.
- `@mulmocast/deck` becomes a `peer` + `dev` dependency of the plugin (host-provided; MulmoTerminal already declares
  it, the `mulmoclaude` launcher gains it).

Known difference from the PNG: a mermaid diagram is drawn at its natural size in the top-left rather than scaled
to fill the slide (`beatToHtml`'s mermaid fragment brings no layout CSS).

## Tests

- `beatHtml`: document for textSlide / markdown contains the fragment and a CSP; runtimes appear only when
  required; unsupported beats → `null`; ids prefixed per index.
- Real app: a deck with textSlide + markdown + chart + mermaid beats renders without any `renderBeat` call.
