// A beat rendered in the browser with mulmocast's `beatToHtml`, wrapped as a self-contained page for a sandboxed
// iframe (`srcdoc`). Pure: no DOM, no network — the iframe does the loading.

import { MulmoPresentationStyleMethods, beatToHtml, type BeatHtmlFragment, type MulmoBeat, type MulmoPresentationStyle } from "mulmocast/browser";
import { getMarkdownStyle } from "mulmocast/data";
import { slideThemeSchema, slideUtilityCss, type SlideTheme } from "@mulmocast/deck";
import { mulmoBeatSchema, mulmoCanvasDimensionSchema, mulmoPresentationStyleSchema } from "@mulmocast/types";
import { isRecord } from "@mulmoclaude/common";

// mulmocast's own HTML export (`actions/html.js`) loads the same runtimes for the same fragments.
const TAILWIND_CDN = "https://cdn.tailwindcss.com";
const CHART_JS_CDN = "https://cdn.jsdelivr.net/npm/chart.js";
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";

// The fragment is not sanitized (see `BeatHtmlFragment.html`) and the iframe has no same-origin access; this policy
// only decides what the page may load. Inline script stays allowed: mermaid's init, the fit script, and author
// script in an `html_tailwind` beat all need it.
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src https: data:",
  "img-src https: data: blob:",
  // A `movie` beat with a URL source comes back as a <video>.
  "media-src https: data: blob:",
].join("; ");

export const DEFAULT_CANVAS = { width: 1280, height: 720 } as const;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface BeatPreviewOptions {
  canvas: CanvasSize;
  slideTheme?: SlideTheme | undefined;
  /** Carries the script's `textSlideParams`, for the text-slide CSS the PNG path applies. */
  presentationStyle: MulmoPresentationStyle;
}

function recordField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Canvas size and deck slide theme from a script, read the way mulmocast resolves them, with its defaults. */
export function previewOptionsOf(script: unknown): BeatPreviewOptions {
  const canvas = mulmoCanvasDimensionSchema.safeParse(recordField(script, "canvasSize"));
  const slideParams = recordField(script, "slideParams") ?? recordField(recordField(script, "presentationStyle"), "slideParams");
  const theme = slideThemeSchema.safeParse(recordField(slideParams, "theme"));
  return {
    canvas: canvas.success ? canvas.data : { ...DEFAULT_CANVAS },
    slideTheme: theme.success ? theme.data : undefined,
    presentationStyle: textSlidePresentationStyle(recordField(script, "textSlideParams")),
  };
}

// `getTextSlideStyle` reads only `textSlideParams`; the schema needs a `$mulmocast` header to parse at all.
const PRESENTATION_HEADER = { $mulmocast: { version: "1.1" } } as const;

function textSlidePresentationStyle(textSlideParams: unknown): MulmoPresentationStyle {
  const withParams = mulmoPresentationStyleSchema.safeParse({ ...PRESENTATION_HEADER, textSlideParams });
  return withParams.success ? withParams.data : mulmoPresentationStyleSchema.parse(PRESENTATION_HEADER);
}

// textSlide / markdown markup comes back bare; the PNG path styles it with the beat's named markdown style or the
// deck's text-slide CSS (mulmocast `resolveCombinedStyle`), and vertically centres a bullet-less textSlide.
function textBeatCss(beat: MulmoBeat, options: BeatPreviewOptions): string {
  const image = beat.image;
  if (!image || (image.type !== "textSlide" && image.type !== "markdown")) return "";
  const named = image.style ? getMarkdownStyle(image.style)?.css : undefined;
  const base = named ?? MulmoPresentationStyleMethods.getTextSlideStyle(options.presentationStyle, beat);
  if (image.type !== "textSlide" || (image.slide.bullets?.length ?? 0) > 0) return base;
  const marginTop = options.canvas.height * (image.slide.subtitle ? 0.4 : 0.45);
  return `${base}\nbody {margin-top: ${marginTop}px;}`;
}

// Same driver as `@mulmocast/deck`'s (not exported there): the chart config rides on each canvas as
// `data-mulmo-chart`, and the page draws it. Runs at the end of <body>, so the canvases already exist.
const CHART_DRIVER = `<script>document.querySelectorAll('canvas[data-mulmo-chart]').forEach(function(ctx){var d=JSON.parse(ctx.dataset.mulmoChart);if(!d.options)d.options={};d.options.animation=false;d.options.responsive=true;d.options.maintainAspectRatio=false;new Chart(ctx,d);});</script>`;

function runtimeTags(fragment: BeatHtmlFragment): string[] {
  const requires = fragment.requires ?? [];
  const tags: string[] = [];
  if (requires.includes("chart")) {
    tags.push(`<script src="${CHART_JS_CDN}"></script>`);
    (fragment.chartPlugins ?? []).forEach((src) => tags.push(`<script src="${src}"></script>`));
  }
  if (requires.includes("mermaid")) tags.push(`<script src="${MERMAID_CDN}"></script>`);
  return tags;
}

function mermaidInit(fragment: BeatHtmlFragment): string {
  if (!(fragment.requires ?? []).includes("mermaid")) return "";
  const theme = fragment.mermaidTheme ?? "default";
  return `<script>mermaid.initialize({ startOnLoad: true, theme: ${JSON.stringify(theme)} });</script>`;
}

export interface BeatDocumentOptions {
  canvas: CanvasSize;
  /** Only `html_tailwind` markup is written against Tailwind; its preflight would reset the text-slide CSS. */
  tailwind: boolean;
}

export function buildBeatHtmlDocument(fragment: BeatHtmlFragment, options: BeatDocumentOptions): string {
  const { canvas } = options;
  const head = [
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
    options.tailwind ? `<script src="${TAILWIND_CDN}"></script>` : "",
    ...runtimeTags(fragment),
    `<style>${slideUtilityCss}</style>`,
    // The host lays the iframe out at the canvas size (`BeatHtmlFrame.vue`), so this only pins the page to it.
    `<style>html,body{width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;background:#fff}</style>`,
    fragment.css ? `<style>${fragment.css}</style>` : "",
  ];
  const chartDriver = (fragment.requires ?? []).includes("chart") ? CHART_DRIVER : "";
  const body = [fragment.html, chartDriver, mermaidInit(fragment)];
  return `<!doctype html><html><head>${head.join("")}</head><body>${body.join("")}</body></html>`;
}

/** The `srcdoc` for a beat, or null when `beatToHtml` cannot render it (the caller keeps the PNG path). */
export function beatPreviewDocument(beat: unknown, index: number, options: BeatPreviewOptions): string | null {
  const parsed = mulmoBeatSchema.safeParse(beat);
  if (!parsed.success) return null;
  try {
    const fragment = beatToHtml(parsed.data, { idPrefix: `beat-${index}`, ...(options.slideTheme ? { slideTheme: options.slideTheme } : {}) });
    if (!fragment) return null;
    const textCss = textBeatCss(parsed.data, options);
    const styled = textCss ? { ...fragment, css: [textCss, fragment.css ?? ""].join("\n") } : fragment;
    return buildBeatHtmlDocument(styled, { canvas: options.canvas, tailwind: parsed.data.image?.type === "html_tailwind" });
  } catch {
    return null;
  }
}
