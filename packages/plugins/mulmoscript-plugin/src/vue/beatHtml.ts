// A beat rendered in the browser with mulmocast's `beatToHtml`, wrapped as a self-contained page for a sandboxed
// iframe (`srcdoc`). Pure: no DOM, no network — the iframe does the loading.

// Schemas and types from the same mulmocast build as beatToHtml. @mulmocast/types validates the same at runtime (it
// reads @mulmocast/deck), but its declarations inline an older deck's slide types (no `figure`).
import {
  MulmoPresentationStyleMethods,
  backgroundImageSchema,
  beatToHtml,
  mulmoBeatSchema,
  mulmoCanvasDimensionSchema,
  mulmoPresentationStyleSchema,
  type BackgroundImage,
  type BeatHtmlFragment,
  type MulmoBeat,
  type MulmoMediaSource,
  type MulmoPresentationStyle,
} from "mulmocast/browser";
import { getMarkdownStyle } from "mulmocast/data";
import { slideBrandingSchema, slideThemeSchema, slideUtilityCss, type SlideBranding, type SlideTheme } from "@mulmocast/deck";
import { isRecord } from "@mulmoclaude/common";

// mulmocast's own HTML export (`actions/html.js`) loads the same runtimes for the same fragments.
const TAILWIND_CDN = "https://cdn.tailwindcss.com";
const CHART_JS_CDN = "https://cdn.jsdelivr.net/npm/chart.js";
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";

// The fragment is not sanitized (see `BeatHtmlFragment.html`) and the iframe has no same-origin access; this policy
// only decides what the page may load. Inline script stays allowed: mermaid's init, the chart driver, and an
// `html_tailwind` beat's `documentScript` all need it. That script may import from any https CDN, as it can in the
// PNG render; the sandbox, not the source list, is what keeps it away from the host.
function previewCsp(authorScripts: boolean): string {
  const scriptSources = authorScripts ? "https:" : "https://cdn.tailwindcss.com https://cdn.jsdelivr.net";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${scriptSources}`,
    "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src https: data:",
    "img-src https: data: blob:",
  ].join("; ");
}

// The generated types the PNG path used to render with Chrome (#3472). `image` / `movie` beats, which beatToHtml also
// draws, point at real files and URLs and stay on the PNG path.
const HTML_PREVIEW_TYPES: ReadonlySet<string> = new Set(["textSlide", "markdown", "chart", "mermaid", "html_tailwind", "slide"]);

export const DEFAULT_CANVAS = { width: 1280, height: 720 } as const;

export interface CanvasSize {
  width: number;
  height: number;
}

// The schema's type admits `null` ("switched off"); a resolved deck value never holds it.
type DeckBackgroundImage = NonNullable<BackgroundImage>;

export interface BeatPreviewOptions {
  canvas: CanvasSize;
  slideTheme?: SlideTheme | undefined;
  /** Carries the script's `textSlideParams`, for the text-slide CSS the PNG path applies. */
  presentationStyle: MulmoPresentationStyle;
  /** The deck's `imageParams.backgroundImage`, painted behind text, chart and mermaid beats. */
  deckBackgroundImage: DeckBackgroundImage | undefined;
  /** The deck's `slideParams.branding` (logo / background), drawn on slide beats. */
  deckBranding: SlideBranding | undefined;
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
    deckBackgroundImage: backgroundImageOf(recordField(recordField(script, "imageParams"), "backgroundImage")),
    deckBranding: brandingOf(recordField(slideParams, "branding")),
  };
}

// mulmocast reads a `null` as "none", like an absent field.
function backgroundImageOf(value: unknown): DeckBackgroundImage | undefined {
  const parsed = backgroundImageSchema.safeParse(value);
  return parsed.success ? (parsed.data ?? undefined) : undefined;
}

function brandingOf(value: unknown): SlideBranding | undefined {
  const parsed = slideBrandingSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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

// Draws each `data-mulmo-chart` canvas, as `@mulmocast/deck`'s driver does (not exported there), plus the
// treemap / sankey colour conversions mulmocast's `assets/html/chart.html` applies for the PNG — JSON cannot carry
// the scriptable colour functions those chart types need. Runs at the end of <body>, so the canvases exist.
export const CHART_DRIVER_JS = [
  "document.querySelectorAll('canvas[data-mulmo-chart]').forEach(function(ctx){",
  "var d=JSON.parse(ctx.dataset.mulmoChart);",
  "if(!d.options)d.options={};d.options.animation=false;d.options.responsive=true;d.options.maintainAspectRatio=false;",
  "var sets=(d.data&&d.data.datasets)||[];",
  "if(d.type==='treemap'){sets.forEach(function(ds){if(Array.isArray(ds.backgroundColor)){var colors=ds.backgroundColor;ds.backgroundColor=function(c){return colors[c.dataIndex%colors.length];};}});}",
  "if(d.type==='sankey'){sets.forEach(function(ds){",
  "if(ds.colorFrom&&typeof ds.colorFrom==='object'){var fromMap=ds.colorFrom;ds.colorFrom=function(c){return fromMap[c.dataset.data[c.dataIndex].from]||'#999';};}",
  "if(ds.colorTo&&typeof ds.colorTo==='object'){var toMap=ds.colorTo;ds.colorTo=function(c){return toMap[c.dataset.data[c.dataIndex].to]||'#999';};}",
  "});}",
  "try{new Chart(ctx,d);}catch(e){console.error('Chart init error:',e);}",
  "});",
].join("");

const CHART_DRIVER = `<script>${CHART_DRIVER_JS}</script>`;

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
  /** Load Tailwind (see `needsTailwind`); its preflight would reset the text-slide CSS, so not for every beat. */
  tailwind: boolean;
}

export function buildBeatHtmlDocument(fragment: BeatHtmlFragment, options: BeatDocumentOptions): string {
  const { canvas } = options;
  const head = [
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${previewCsp(Boolean(fragment.documentScript))}">`,
    options.tailwind ? `<script src="${TAILWIND_CDN}"></script>` : "",
    ...runtimeTags(fragment),
    `<style>${slideUtilityCss}</style>`,
    // The host lays the iframe out at the canvas size (`BeatHtmlFrame.vue`), so this only pins the page to it. White
    // goes on body alone so it spreads to the canvas, as in the PNG page; on html it would cover a background's ::before.
    `<style>html,body{width:${canvas.width}px;height:${canvas.height}px;overflow:hidden}body{background:#fff}</style>`,
    // Background first, as the PNG path writes it, so a text beat's own rules still win where both set a property.
    fragment.documentCss ? `<style>${fragment.documentCss}</style>` : "",
    fragment.css ? `<style>${fragment.css}</style>` : "",
  ];
  const chartDriver = (fragment.requires ?? []).includes("chart") ? CHART_DRIVER : "";
  const body = [fragment.html, fragment.documentScript ?? "", chartDriver, mermaidInit(fragment)];
  return `<!doctype html><html><head>${head.join("")}</head><body>${body.join("")}</body></html>`;
}

// Which fragments are written against Tailwind, per mulmocast's docs/api.md ("Providing Tailwind"): deck draws
// slide / chart / mermaid and always needs it; markdown only for a layout object or a mermaid fence; textSlide never;
// html_tailwind is author markup and gets it as the PNG render does.
const ALWAYS_TAILWIND_TYPES: ReadonlySet<string> = new Set(["slide", "chart", "mermaid", "html_tailwind"]);

function needsTailwind(beat: MulmoBeat, fragment: BeatHtmlFragment): boolean {
  const image = beat.image;
  if (!image) return false;
  if (ALWAYS_TAILWIND_TYPES.has(image.type)) return true;
  if (image.type !== "markdown") return false;
  // A layout object (incl. 2x2), or a mermaid fence — read from what beatToHtml actually produced, not re-lexed here.
  const isLayout = typeof image.markdown !== "string" && !Array.isArray(image.markdown);
  return isLayout || (fragment.requires ?? []).includes("mermaid");
}

// A `path` image sits next to the script on disk, where the PNG path reads it and the sandboxed preview cannot, so a
// beat whose background or branding uses one stays on the PNG path. So does a chart / mermaid beat with a named
// `style`, which beatToHtml does not apply. A beat-level `null` switches the deck's setting off, as mulmocast resolves it.
const BACKGROUND_IMAGE_TYPES: ReadonlySet<string> = new Set(["textSlide", "markdown", "chart", "mermaid"]);

function isLocalFile(source: { kind: string } | undefined): boolean {
  return source?.kind === "path";
}

function backgroundReadsLocalFile(beatValue: unknown, deckValue: DeckBackgroundImage | undefined): boolean {
  const resolved = beatValue === undefined ? deckValue : backgroundImageOf(beatValue);
  return typeof resolved === "object" && isLocalFile(resolved.source);
}

function brandingReadsLocalFile(beatValue: SlideBranding | null | undefined, deckValue: SlideBranding | undefined): boolean {
  const resolved = beatValue === undefined ? deckValue : (beatValue ?? undefined);
  return isLocalFile(resolved?.logo?.source) || isLocalFile(resolved?.backgroundImage?.source);
}

function needsPngRender(beat: MulmoBeat, options: BeatPreviewOptions): boolean {
  const image = beat.image;
  if (!image) return false;
  if (image.type === "slide") return brandingReadsLocalFile(image.branding, options.deckBranding);
  if (!BACKGROUND_IMAGE_TYPES.has(image.type)) return false;
  if ((image.type === "chart" || image.type === "mermaid") && image.style) return true;
  return backgroundReadsLocalFile(recordField(image, "backgroundImage"), options.deckBackgroundImage);
}

/** A background or branding image as the PNG path inlines it (`MulmoMediaSourceMethods.toDataUrl`): a url as
 *  written, base64 as a PNG `data:` URI unless it already is one. A `path` never gets here (`needsPngRender`). */
export function previewMediaUrl(source: MulmoMediaSource): string | undefined {
  if (source.kind === "url") return source.url;
  if (source.kind === "base64") return source.data.startsWith("data:") ? source.data : `data:image/png;base64,${source.data}`;
  return undefined;
}

/** The `srcdoc` for a beat, or null when `beatToHtml` cannot render it (the caller keeps the PNG path). */
export function beatPreviewDocument(beat: unknown, index: number, options: BeatPreviewOptions): string | null {
  const parsed = mulmoBeatSchema.safeParse(beat);
  if (!parsed.success || !HTML_PREVIEW_TYPES.has(parsed.data.image?.type ?? "") || needsPngRender(parsed.data, options)) return null;
  try {
    const fragment = beatToHtml(parsed.data, {
      idPrefix: `beat-${index}`,
      resolveMediaUrl: previewMediaUrl,
      ...(options.slideTheme ? { slideTheme: options.slideTheme } : {}),
      ...(options.deckBackgroundImage ? { backgroundImage: options.deckBackgroundImage } : {}),
      ...(options.deckBranding ? { branding: options.deckBranding } : {}),
    });
    if (!fragment) return null;
    const textCss = textBeatCss(parsed.data, options);
    const styled = textCss ? { ...fragment, css: [textCss, fragment.css ?? ""].join("\n") } : fragment;
    return buildBeatHtmlDocument(styled, { canvas: options.canvas, tailwind: needsTailwind(parsed.data, fragment) });
  } catch {
    return null;
  }
}
