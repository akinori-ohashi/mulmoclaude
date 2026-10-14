// A beat rendered in the browser with mulmocast's `beatToHtml`, wrapped as a self-contained page for a sandboxed
// iframe (`srcdoc`). Pure: no DOM, no network — the iframe does the loading.

// Schemas and types from the same mulmocast build as beatToHtml. @mulmocast/types validates the same at runtime (it
// reads @mulmocast/deck), but its declarations inline an older deck's slide types (no `figure`).
import {
  MulmoPresentationStyleMethods,
  beatToHtml,
  mulmoBeatSchema,
  mulmoCanvasDimensionSchema,
  mulmoPresentationStyleSchema,
  type BeatHtmlFragment,
  type MulmoBeat,
  type MulmoPresentationStyle,
} from "mulmocast/browser";
import { getMarkdownStyle } from "mulmocast/data";
import { slideThemeSchema, slideUtilityCss, type SlideTheme } from "@mulmocast/deck";
import { isRecord } from "@mulmoclaude/common";

// mulmocast's own HTML export (`actions/html.js`) loads the same runtimes for the same fragments.
const TAILWIND_CDN = "https://cdn.tailwindcss.com";
const CHART_JS_CDN = "https://cdn.jsdelivr.net/npm/chart.js";
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";

// The fragment is not sanitized (see `BeatHtmlFragment.html`) and the iframe has no same-origin access; this policy
// only decides what the page may load. Inline script stays allowed: mermaid's init, the chart driver, and author
// script in an `html_tailwind` beat all need it. An `html_tailwind` author script may import from any https CDN,
// as it can in the PNG render; the sandbox, not the source list, is what keeps it away from the host.
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

export interface BeatPreviewOptions {
  canvas: CanvasSize;
  slideTheme?: SlideTheme | undefined;
  /** Carries the script's `textSlideParams`, for the text-slide CSS the PNG path applies. */
  presentationStyle: MulmoPresentationStyle;
  /** The deck sets `imageParams.backgroundImage`, which the PNG path paints behind text, chart and mermaid beats. */
  deckBackgroundImage: boolean;
  /** The deck sets `slideParams.branding` (logo / background), which the PNG path draws on slide beats. */
  deckBranding: boolean;
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
    // mulmocast reads a deck-level `null` as "none", like an absent field.
    deckBackgroundImage: recordField(recordField(script, "imageParams"), "backgroundImage") != null,
    deckBranding: recordField(slideParams, "branding") != null,
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

/** An `html_tailwind` beat's `script` field as mulmocast's PNG render injects it: a module script when it uses
 *  ESM `import` / `export`, a classic one otherwise. beatToHtml leaves the field out. */
export function authorScriptTag(script: string | readonly string[] | undefined): string {
  // Same test as mulmocast's `buildUserScript` (`if (!script)`): an empty string is no script.
  if (script === undefined || script === "") return "";
  const code = typeof script === "string" ? script : script.join("\n");
  const isModule = code.split("\n").some((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith("import ") || trimmed.startsWith("export ");
  });
  return isModule ? `<script type="module">\n${code}\n</script>` : `<script>\n${code}\n</script>`;
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

export interface BeatDocumentOptions {
  canvas: CanvasSize;
  /** Load Tailwind (see `needsTailwind`); its preflight would reset the text-slide CSS, so not for every beat. */
  tailwind: boolean;
  /** The `html_tailwind` beat's own `script` field, appended after its markup. */
  authorScript?: string;
}

export function buildBeatHtmlDocument(fragment: BeatHtmlFragment, options: BeatDocumentOptions): string {
  const { canvas } = options;
  const head = [
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${previewCsp(Boolean(options.authorScript))}">`,
    options.tailwind ? `<script src="${TAILWIND_CDN}"></script>` : "",
    ...runtimeTags(fragment),
    `<style>${slideUtilityCss}</style>`,
    // The host lays the iframe out at the canvas size (`BeatHtmlFrame.vue`), so this only pins the page to it.
    `<style>html,body{width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;background:#fff}</style>`,
    fragment.css ? `<style>${fragment.css}</style>` : "",
  ];
  const chartDriver = (fragment.requires ?? []).includes("chart") ? CHART_DRIVER : "";
  const body = [fragment.html, options.authorScript ?? "", chartDriver, mermaidInit(fragment)];
  return `<!doctype html><html><head>${head.join("")}</head><body>${body.join("")}</body></html>`;
}

// beatToHtml emits an html_tailwind beat at rest. Its `script` field is added back here (`authorScriptTag`), but
// the swipe `elements` driver and frame `animation` need mulmocast's render loop, so such a beat stays on the PNG path.
function needsScriptedRender(beat: MulmoBeat): boolean {
  const image = beat.image;
  if (!image || image.type !== "html_tailwind") return false;
  return image.elements !== undefined || image.animation !== undefined;
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

// The PNG path paints a background image behind these beats and branding on slides (often local files the browser
// cannot reach), and styles chart / mermaid with a named `style`; beatToHtml's markup carries none of them, so such
// a beat stays on the PNG path. A beat-level `null` switches the deck's setting off, as mulmocast resolves it.
const BACKGROUND_IMAGE_TYPES: ReadonlySet<string> = new Set(["textSlide", "markdown", "chart", "mermaid"]);

function resolvesToSet(beatValue: unknown, deckValue: boolean): boolean {
  if (beatValue === null) return false;
  return beatValue !== undefined || deckValue;
}

function needsDecoration(beat: MulmoBeat, options: BeatPreviewOptions): boolean {
  const image = beat.image;
  if (!image) return false;
  if (image.type === "slide") return resolvesToSet(image.branding, options.deckBranding);
  if (!BACKGROUND_IMAGE_TYPES.has(image.type)) return false;
  if ((image.type === "chart" || image.type === "mermaid") && image.style) return true;
  return resolvesToSet(recordField(image, "backgroundImage"), options.deckBackgroundImage);
}

/** The `srcdoc` for a beat, or null when `beatToHtml` cannot render it (the caller keeps the PNG path). */
export function beatPreviewDocument(beat: unknown, index: number, options: BeatPreviewOptions): string | null {
  const parsed = mulmoBeatSchema.safeParse(beat);
  if (!parsed.success || !HTML_PREVIEW_TYPES.has(parsed.data.image?.type ?? "") || needsScriptedRender(parsed.data) || needsDecoration(parsed.data, options))
    return null;
  try {
    const fragment = beatToHtml(parsed.data, { idPrefix: `beat-${index}`, ...(options.slideTheme ? { slideTheme: options.slideTheme } : {}) });
    if (!fragment) return null;
    const textCss = textBeatCss(parsed.data, options);
    const styled = textCss ? { ...fragment, css: [textCss, fragment.css ?? ""].join("\n") } : fragment;
    const image = parsed.data.image;
    const authorScript = image?.type === "html_tailwind" ? authorScriptTag(image.script) : "";
    return buildBeatHtmlDocument(styled, { canvas: options.canvas, tailwind: needsTailwind(parsed.data, fragment), ...(authorScript ? { authorScript } : {}) });
  } catch {
    return null;
  }
}
