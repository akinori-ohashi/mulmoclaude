// A beat rendered in the browser with mulmocast's `beatToHtml`, wrapped as a self-contained page for a sandboxed
// iframe (`srcdoc`). Pure: no DOM, no network — the iframe does the loading.

import { beatToHtml, type BeatHtmlFragment } from "mulmocast/browser";
import { slideThemeSchema, slideUtilityCss, type SlideTheme } from "@mulmocast/deck";
import { mulmoBeatSchema, mulmoCanvasDimensionSchema } from "@mulmocast/types";
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
].join("; ");

export const DEFAULT_CANVAS = { width: 1280, height: 720 } as const;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface BeatPreviewOptions {
  canvas: CanvasSize;
  slideTheme?: SlideTheme | undefined;
}

function recordField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Canvas size and deck slide theme from a script, read the way mulmocast resolves them, with its defaults. */
export function previewOptionsOf(script: unknown): BeatPreviewOptions {
  const canvas = mulmoCanvasDimensionSchema.safeParse(recordField(script, "canvasSize"));
  const slideParams = recordField(script, "slideParams") ?? recordField(recordField(script, "presentationStyle"), "slideParams");
  const theme = slideThemeSchema.safeParse(recordField(slideParams, "theme"));
  return { canvas: canvas.success ? canvas.data : { ...DEFAULT_CANVAS }, slideTheme: theme.success ? theme.data : undefined };
}

// Lays the page out at the script's canvas size and scales it to the iframe, the way the PNG would look.
function fitScript(canvas: CanvasSize): string {
  return `<script>(function(){var w=${canvas.width},h=${canvas.height};function fit(){var s=Math.min(innerWidth/w,innerHeight/h);document.documentElement.style.zoom=String(s);}addEventListener("resize",fit);fit();})();</script>`;
}

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

export function buildBeatHtmlDocument(fragment: BeatHtmlFragment, canvas: CanvasSize): string {
  const head = [
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
    `<script src="${TAILWIND_CDN}"></script>`,
    ...runtimeTags(fragment),
    `<style>${slideUtilityCss}</style>`,
    `<style>html,body{margin:0;width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;background:#fff}</style>`,
    fragment.css ? `<style>${fragment.css}</style>` : "",
  ];
  const body = [fragment.html, mermaidInit(fragment), fitScript(canvas)];
  return `<!doctype html><html><head>${head.join("")}</head><body>${body.join("")}</body></html>`;
}

/** The `srcdoc` for a beat, or null when `beatToHtml` cannot render it (the caller keeps the PNG path). */
export function beatPreviewDocument(beat: unknown, index: number, options: BeatPreviewOptions): string | null {
  const parsed = mulmoBeatSchema.safeParse(beat);
  if (!parsed.success) return null;
  try {
    const fragment = beatToHtml(parsed.data, { idPrefix: `beat-${index}`, ...(options.slideTheme ? { slideTheme: options.slideTheme } : {}) });
    return fragment ? buildBeatHtmlDocument(fragment, options.canvas) : null;
  } catch {
    return null;
  }
}
