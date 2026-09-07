// Marked extension that turns TeX math into placeholder elements. The
// actual typesetting is deferred to `mathRender.ts`, which scans the
// placeholders in the DOM after Vue's v-html injects the html — the
// same two-step split `mermaidExtension.ts` / `mermaidRender.ts` use,
// and for the same two reasons: this file stays pure (no runtime dep
// beyond `marked` and the zero-dep `@mulmoclaude/common` leaf) so the
// html shape is testable without a browser, and the MathJax runtime
// stays out of the initial bundle.
//
// Why MathJax SVG and not KaTeX:
//   - The rendered output is a self-contained `<svg>` using
//     `currentColor` — no stylesheet and no webfont files to ship in
//     the published npm tarball. KaTeX's html output needs
//     `katex.min.css` plus ~60 woff2 files.
//   - Marp decks already render math through marp-core, which uses
//     MathJax SVG by default. Rendering the plain-markdown preview the
//     same way keeps one document from looking like two.
//   - KaTeX's `mathml` output survives `sanitizeMarkdownHtml` badly:
//     DOMPurify drops `<semantics>`/`<annotation>` but keeps the
//     annotation's TEXT, so the raw LaTeX source lands next to the
//     formula as visible garbage.
//
// Delimiter rules. `$` is a currency symbol far more often than it is
// a math delimiter, so the inline form is deliberately strict — the
// Pandoc rule set, which is what stops `$100 と $200` from swallowing
// the prose between two prices:
//
//   1. The opening `$` must not be preceded by an ASCII alphanumeric
//      (`US$5`) or by a backslash (`\$`, an escaped literal).
//   2. The character AFTER the opening `$` must not be whitespace.
//   3. The character BEFORE the closing `$` must not be whitespace,
//      and must not be a backslash.
//   4. The character AFTER the closing `$` must not be an ASCII digit
//      (`$5-$10`).
//   5. The body must be non-empty, single-line, and must be something a
//      formula could be ABOUT: a number written the way money is
//      (`$1,000$`, `$1.000,50$` — a price written twice) or separators
//      with no digits at all (`$+$`) are not.
//
// Rule 5 used to reject EVERY digits-and-separators body, and that was
// too wide: `1秒を $10000$ 個のステップに割る` and `答えは $1$` are the
// ordinary way to write a number in a maths article, and both came out
// as a literal `$10000$` / `$1$` sitting in the prose. The signature of
// a price is its SHAPE — digits in threes, or more than one separator —
// and the two shapes that actually
// appear in currency prose are already dead: `$100 と $200` by rule 3
// (whitespace before the close) and `$5-$10` by rule 4 (a digit after
// it). What stays admitted is a body like `$5$`, which a person quoting
// a price does not write: they write `$5`, and it is the DOUBLED
// delimiter that makes it maths.
//
// The SHAPE is matched rather than a particular separator, because a
// comma groups thousands in English and marks the decimal in most of
// Europe, and a dot does the opposite (codex, #2985). `$1,5$` is one and
// a half and typesets; `$1.000,50$` carries both a grouping AND a
// decimal mark, which no one computes with, and does not.
//
// A number with ONE separator typesets whatever follows it. Reading
// three digits after it as money cost every three-decimal constant a
// maths article writes (`$3.141$`, `$1.414$`, `$2.718$`) and bought only
// `$1,500$` — a shape currency prose never reaches, because rules 1-4
// kill every realistic way of writing a price first (#2991).
//
// Rules 2-5 are enforced in the tokenizer, where the whole match is in
// hand. Rule 1 needs the character BEFORE the match, which a marked
// inline tokenizer never sees — its `src` always begins at the current
// cursor. It is enforced in `start()` instead, which scans forward
// through the remaining source and therefore does have the preceding
// character for every `$` except one sitting at index 0 of the
// remainder (only reachable when the previous inline token ended
// exactly there). Best-effort by construction; the four tokenizer
// rules carry the rest.
//
// `$$…$$` is unambiguous, so display math is not subject to rules 1-4.

import type { MarkedExtension, TokenizerAndRendererExtension, Tokens } from "marked";
import { escapeHtml } from "@mulmoclaude/common";

/** Token shape both math extensions emit. `display` picks MathJax's
 *  display vs inline typesetting mode. */
interface MathToken extends Tokens.Generic {
  type: "mathInline" | "mathBlock";
  raw: string;
  text: string;
  display: boolean;
}

const ASCII_ALNUM = /[A-Za-z0-9]/;
const ASCII_DIGIT = /\d/;
const DIGITS = /^\d+$/;
/** Every character that separates the digit runs of a written number,
 *  in any locale: `1,000.50`, `1.000,50`, `1 000,50`. Which one groups
 *  and which one marks the decimal is exactly what cannot be known, so
 *  none of them is read as one or the other. */
const NUMBER_SEPARATORS = /[.,\s]/;

/** A bare number written the way MONEY is written rather than the way a
 *  quantity is — `1,000`, `1.000`, `1 000`, `1.000,50`, `12,345,678`.
 *
 *  Read from the SHAPE, not from which separator appeared: a comma
 *  groups thousands in English and marks the decimal in most of Europe,
 *  and a dot does the opposite, so a rule that names one of them fails
 *  half the world's authors either way (codex, #2985).
 *
 *  Two separators or more is money: `1.000,50` groups AND marks a
 *  decimal, which is a formatted amount rather than a quantity anyone
 *  computes with.
 *
 *  ONE separator is not, whatever follows it. That branch used to read
 *  "exactly three digits after it" as money, and the cost was every
 *  three-decimal constant a maths article writes — `3.141`, `1.414`,
 *  `2.718`, `1.618`, `0.577`, `6.022`, `9.807` all came out as literal
 *  `$…$` in the prose (#2991). What it bought was `$1,500$`, and that
 *  turns out to be a shape currency prose never reaches: every realistic
 *  form dies earlier, at rules 1-4 —
 *
 *      `$1,000 と $2,000`      rule 3, whitespace before the close
 *      `合計 $1,000から$500`    rule 3
 *      `$1,000-$2,000`        rule 4, a digit after the close
 *      `US$1,000`             rule 1, alphanumeric before the open
 *      `価格は $1,000 です`      no closing `$` at all
 *
 *  — leaving only `$1,000$`, both delimiters written out. That is the
 *  same shape this file already reads as maths for `$5$`: a person
 *  quoting a price writes `$1,000`, and it is the DOUBLED delimiter that
 *  makes it a formula. Rule 5 was applying one reading to `$5$` and the
 *  opposite to `$1,500$`; now it applies the same one to both. */
function isMoneyShaped(body: string): boolean {
  const runs = body.split(NUMBER_SEPARATORS);
  // Anything that is not digits-and-separators is not a written number at
  // all — `x=1` and `\pi` land here and are maths by this rule.
  if (!runs.every((run) => DIGITS.test(run))) return false;
  return runs.length > 2;
}
/** The same set with the digits removed: a body of punctuation has
 *  nothing to typeset. */
const SEPARATORS_ONLY = /^[\s.,:;%+-]*$/;

/** Index of the first `$` in `src` that could legally open math, or
 *  `undefined` when there is none. Marked uses this to cut the
 *  preceding text token, so returning a position is what gets the
 *  tokenizer invoked there at all. */
export function findMathStart(src: string): number | undefined {
  let from = 0;
  for (;;) {
    const index = src.indexOf("$", from);
    if (index < 0) return undefined;
    const prev = index === 0 ? "" : (src[index - 1] ?? "");
    // Rule 1: not `US$5`, not an escaped `\$`.
    if (prev !== "\\" && !ASCII_ALNUM.test(prev)) return index;
    from = index + 1;
  }
}

/** True when `body` passes the strict inline-`$` rules 2-5. `after` is
 *  the character following the closing delimiter (empty at end of
 *  input). */
export function isPlausibleInlineMath(body: string, after: string): boolean {
  if (body.length === 0) return false;
  if (body.includes("\n")) return false;
  // Rule 2 / 3: no whitespace hugging either delimiter.
  if (/^\s/.test(body) || /\s$/.test(body)) return false;
  // Rule 3, second half: `\` before the closing `$` escapes it.
  if (body.endsWith("\\")) return false;
  // Rule 4: `$5-$10`.
  if (ASCII_DIGIT.test(after)) return false;
  // Rule 5. The shape of money is what says "price"; a plain number is
  // just a number, and a number in a maths article is maths.
  if (isMoneyShaped(body)) return false;
  if (SEPARATORS_ONLY.test(body)) return false;
  return true;
}

/** Placeholder `mathRender.ts` looks for. The TeX source rides in the
 *  element's text content — DOMPurify preserves text verbatim, and
 *  reading it back out of the DOM decodes the entities natively, so no
 *  manual unescaping is needed downstream.
 *
 *  `block` picks the wrapper element and is independent of `display`:
 *  a `$$…$$` sitting mid-sentence typesets in display mode but must
 *  still emit a `<span>`, because marked has it inside a `<p>` and a
 *  `<div>` there is invalid nesting the browser silently reflows. */
export function mathPlaceholder(tex: string, opts: { display: boolean; block: boolean }): string {
  const escaped = escapeHtml(tex);
  const flag = opts.display ? "1" : "0";
  const attrs = `data-math-pending="1" data-math-display="${flag}"`;
  if (opts.block) return `<div class="math-block" ${attrs}>${escaped}</div>\n`;
  return `<span class="math-inline" ${attrs}>${escaped}</span>`;
}

// `$$…$$` occupying its own line(s). Registered at block level so it
// does not end up wrapped in a paragraph with the surrounding prose.
const BLOCK_FENCED = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?:\n+|$)/;
const BLOCK_ONE_LINE = /^ {0,3}\$\$([^\n]+?)\$\$[ \t]*(?:\n+|$)/;

/** Index of the first `$$` that begins a line (up to 3 leading spaces),
 *  or `undefined`. A block-level `start()` truncates the paragraph
 *  marked is accumulating, so pointing it at a mid-sentence `$$…$$`
 *  would split the prose around an inline formula. Only a line-leading
 *  `$$` can possibly satisfy the block tokenizer, so only those are
 *  worth stopping for — mid-paragraph display math is picked up by the
 *  inline extension instead. */
export function findMathBlockStart(src: string): number | undefined {
  const match = /(^|\n) {0,3}\$\$/.exec(src);
  if (!match) return undefined;
  // Point at the `$$` itself, not at the newline that precedes it.
  return match.index + match[0].length - 2;
}

/** Type predicate rather than a cast: marked hands renderers a bare
 *  `Tokens.Generic`, and both extensions here are the only producers of
 *  these two token types, so the shape is checked once at the boundary
 *  instead of asserted. */
function isMathToken(token: Tokens.Generic): token is MathToken {
  return typeof token.text === "string" && typeof token.display === "boolean";
}

const mathBlock: TokenizerAndRendererExtension = {
  name: "mathBlock",
  level: "block",
  start: findMathBlockStart,
  tokenizer(src: string): MathToken | undefined {
    const match = BLOCK_FENCED.exec(src) ?? BLOCK_ONE_LINE.exec(src);
    const text = match?.[1]?.trim();
    if (!match || text === undefined) return undefined;
    if (text.length === 0) return undefined;
    return { type: "mathBlock", raw: match[0], text, display: true };
  },
  renderer(token) {
    if (!isMathToken(token)) return "";
    return mathPlaceholder(token.text, { display: true, block: true });
  },
};

// `$$…$$` inside a paragraph (display mode) and `$…$` (inline mode).
const INLINE_DISPLAY = /^\$\$([^\n]+?)\$\$/;
// The body alternates an escaped dollar against any other non-`$`
// character, rather than excluding `$` outright: an escaped dollar has
// to be consumed as ONE unit, or the first `\$` is taken for the closing
// delimiter and a legitimate `$\text{Cost: \$5}$` is cut at the
// backslash — where `isPlausibleInlineMath` then rejects it for ending
// in one. The escape branch is ordered first so it wins the match.
const INLINE_PLAIN = /^\$((?:\\\$|[^\n$])+?)\$/;

const mathInline: TokenizerAndRendererExtension = {
  name: "mathInline",
  level: "inline",
  start: findMathStart,
  tokenizer(src: string): MathToken | undefined {
    const display = INLINE_DISPLAY.exec(src);
    const displayText = display?.[1]?.trim();
    if (display && displayText !== undefined) {
      if (displayText.length === 0) return undefined;
      return { type: "mathInline", raw: display[0], text: displayText, display: true };
    }
    const plain = INLINE_PLAIN.exec(src);
    const body = plain?.[1];
    if (!plain || body === undefined) return undefined;
    const after = src.slice(plain[0].length, plain[0].length + 1);
    if (!isPlausibleInlineMath(body, after)) return undefined;
    return { type: "mathInline", raw: plain[0], text: body, display: false };
  },
  renderer(token) {
    if (!isMathToken(token)) return "";
    return mathPlaceholder(token.text, { display: token.display, block: false });
  },
};

/** Register with `marked.use(mathExtension)`. Pair with
 *  `renderMathNodes()` from `mathRender.js` on the injected DOM. */
export const mathExtension: MarkedExtension = {
  extensions: [mathBlock, mathInline],
};
