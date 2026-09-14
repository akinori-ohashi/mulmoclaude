// Author-supplied raw HTML in markdown may carry neither `class` nor
// `style`.
//
// WHY, and why the narrower rules do not work. Markdown passes raw HTML
// straight through, and DOMPurify's defaults keep both attributes. That
// lets a rendered file position content of its own over the app's output:
// a `<pre>` absolutely positioned across a fenced code block, with an
// opaque background, makes the reader see one command while the block
// underneath holds another — and both the copy button and a plain text
// selection then take the hidden one. Measured in a real browser
// (receptron/mulmoclaude#3151).
//
// Banning `style` alone does NOT close it. This app ships a utility-CSS
// framework, so the same overlay is available as `class="absolute inset-0
// bg-white pointer-events-none"` with no `style` anywhere — every one of
// those utilities is in the shipped stylesheet because the app's own UI
// uses them. `mathRender.ts` warned about exactly this: a utility-CSS
// framework turns a class name into positioning. A denylist of CSS
// properties or class names is the shape that comes back every time
// someone finds one more spelling, so the rule states what is PERMITTED:
// neither attribute, on author HTML only.
//
// It applies to author HTML ONLY, which is possible because `marked`
// routes raw HTML — and nothing else — through `renderer.html`. Highlight
// spans, the copy button, mermaid placeholders and wiki EMBEDS come from
// other renderers and keep their classes. The markdown-level sanitiser
// cannot make that distinction: by the time it runs, the two are one
// document.
//
// One kind of app markup is NOT safe by that argument, and assuming it was
// broke every `[[wiki-link]]` in the app. `renderWikiLinks` rewrites `[[x]]`
// into a `<span class="wiki-link">` and injects it into the markdown SOURCE,
// before marked runs — so it arrives here as an author raw-HTML token and is
// indistinguishable from one. Losing the class cost both the styling and
// `WikiPageBody`'s `closest(".wiki-link")` click handler. Pre-injected app
// markup therefore has to identify itself, and the only way it can do that
// against an author who may write any static text is a nonce the author
// cannot guess — the same defence the copy button uses.

import type { MarkedExtension, Tokens } from "marked";
import { createCodeCopyNonce } from "./codeCopyExtension.js";

/** Attributes an author may not set. Presentation only — this is not the
 *  XSS boundary, which stays with DOMPurify. */
const FORBIDDEN = ["class", "style"];

/** Attribute by which app markup injected into the markdown SOURCE declares
 *  itself. Its value must equal the nonce of the parse currently running; a
 *  bare or stale marker is treated as author text and stripped along with it. */
export const APP_MARKUP_ATTR = "data-app-markup";

// Empty means "trust nothing", which is the state every surface is in except
// during the one synchronous `parse()` that `withTrustedAppMarkup` wraps. An
// author token carrying an empty marker must never match, hence the guard in
// `trustedMarker` rather than a plain comparison.
let trustedNonce = "";

/** A value author markup cannot guess. Delegates rather than reimplements:
 *  the copy button already owns the CSPRNG-only helper, and a second
 *  implementation of "make an unguessable value" is how one of them ends up
 *  with a `Math.random` fallback. Returns "" when there is no CSPRNG, which
 *  fails CLOSED — nothing is trusted. */
export function createAppMarkupNonce(): string {
  return createCodeCopyNonce();
}

/** Runs `parse` with `nonce` trusted. Synchronous by contract: marked's
 *  renderers run inline, so the window closes before any other render can
 *  start. An async marked extension would break that and is why the wiki
 *  pipeline asserts its result is a string. */
export function withTrustedAppMarkup<T>(nonce: string, parse: () => T): T {
  // Restores rather than clears: an inner render finishing must not revoke the
  // trust an outer one is still relying on.
  const outer = trustedNonce;
  trustedNonce = nonce;
  try {
    return parse();
  } finally {
    trustedNonce = outer;
  }
}

/** The exact attribute text app markup must carry to keep its attributes,
 *  or "" when nothing is trusted. */
function trustedMarker(): string {
  if (trustedNonce === "") return "";
  return `${APP_MARKUP_ATTR}="${trustedNonce}"`;
}

const isAsciiLetter = (char: string): boolean => (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");

// HTML's whitespace is EXACTLY tab, LF, FF, CR and space. JavaScript's `\s`
// is wider — NBSP, vertical tab, U+2028 and more — and using it here made
// the scanner treat characters the tokenizer does not as attribute
// separators: `<div\u00a0class=x>` has no `class` attribute to a parser, yet
// it was being rewritten to `<div>` (codex round 6). Anywhere whitespace is
// HTML SYNTAX, it has to be this set and not `\s`.
const HTML_WHITESPACE = [" ", "\t", "\n", "\f", "\r"];
const isHtmlWhitespace = (char: string): boolean => HTML_WHITESPACE.includes(char);

// Elements whose content the HTML parser reads as TEXT, not markup. Inside
// them a `<div class=x>` is characters a reader is meant to see, so
// rewriting it corrupts the document rather than protecting anyone —
// `<textarea><div class=foo></textarea>` was coming out as
// `<textarea><div></textarea>` (codex round 2). Only `textarea` currently
// survives the sanitiser; the rest are here because this helper is exported
// and must not depend on that staying true.
const RAW_TEXT_ELEMENTS = ["textarea", "title", "script", "style", "xmp", "iframe", "noembed", "noframes", "plaintext"];

/** `<plaintext>` has no end tag at all — it consumes the rest of the
 *  document, `</plaintext>` included. Treating it like the others resumed
 *  markup after a close tag no parser honours (codex round 3). */
const UNCLOSEABLE_RAW_TEXT = "plaintext";

/** Name of the tag starting at `start`, lower-cased; "" for a closing tag
 *  or anything that is not a plain element name. */
function openingTagName(fragment: string, start: number): string {
  const match = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(fragment.slice(start));
  return match === null ? "" : (match[1] ?? "").toLowerCase();
}

/** Index just past a `<!…>` run: `-->` for a real comment, the first `>`
 *  for a doctype or bogus comment. */
function commentEnd(fragment: string, start: number): number {
  if (fragment.startsWith("<!--", start)) {
    const close = fragment.indexOf("-->", start + 4);
    return close === -1 ? fragment.length : close + 3;
  }
  const close = fragment.indexOf(">", start);
  return close === -1 ? fragment.length : close + 1;
}

/** Index just past the element's APPROPRIATE END TAG, searched from `from`.
 *
 *  "Appropriate" is HTML's own definition, not a rule of mine: the name has
 *  to be followed by whitespace, `/` or `>`. A prefix match ends raw text at
 *  `</textareax>`, which no parser does — verified against jsdom, where
 *  `<textarea>keep </textareax><div class=foo></textarea>` has the VALUE
 *  `keep </textareax><div class=foo>` (codex round 3).
 *
 *  The END of the fragment when there is no such tag, which is again what the
 *  parser does, and the right answer when `marked` has split the element
 *  across chunks. */
function rawTextEnd(fragment: string, from: number, name: string): number {
  if (name === UNCLOSEABLE_RAW_TEXT) return fragment.length;
  const lowered = fragment.toLowerCase();
  const needle = `</${name}`;
  let search = from;
  for (;;) {
    const close = lowered.indexOf(needle, search);
    if (close === -1) return fragment.length;
    const after = fragment[close + needle.length] ?? ">";
    if (after === ">" || after === "/" || isHtmlWhitespace(after)) {
      const closeEnd = fragment.indexOf(">", close);
      return closeEnd === -1 ? fragment.length : closeEnd + 1;
    }
    search = close + 1;
  }
}

/** True when `<` at `index` opens a tag rather than being literal text.
 *  `a < b` in prose must survive untouched. */
function opensTag(fragment: string, index: number): boolean {
  const next = fragment[index + 1];
  if (next === undefined) return false;
  return isAsciiLetter(next) || next === "/";
}

/** Index just past the `>` that closes the tag starting at `start`, with
 *  quoted attribute values skipped so a `>` inside one does not end it.
 *  Returns the string length for an unterminated tag. */
function tagEnd(fragment: string, start: number): number {
  let quote = "";
  // A quote opens a VALUE only after `=`. In attribute-name position a
  // quote is a parse error that the tokenizer keeps as part of the name,
  // so treating every quote as a value delimiter swallowed the rest of
  // the tag: `<div ">text class=x</div>` lost its literal text, because
  // the `"` was read as opening a value that ran past the `>`
  // (codex round 5).
  let afterEquals = false;
  for (let index = start; index < fragment.length; index += 1) {
    const char = fragment[index] ?? "";
    if (quote !== "") {
      if (char === quote) quote = "";
      continue;
    }
    if (char === ">") return index + 1;
    if (char === "=") {
      afterEquals = true;
      continue;
    }
    // Whitespace between `=` and the value does not end the wait for one.
    if (isHtmlWhitespace(char)) continue;
    if (afterEquals && (char === '"' || char === "'")) {
      quote = char;
    }
    afterEquals = false;
  }
  return fragment.length;
}

/** Index just past an attribute value beginning at `start` (which may be
 *  quoted or bare). */
function valueEnd(tag: string, start: number): number {
  const first = tag[start];
  if (first === '"' || first === "'") {
    const close = tag.indexOf(first, start + 1);
    return close === -1 ? tag.length : close + 1;
  }
  let index = start;
  while (index < tag.length && !isHtmlWhitespace(tag[index] ?? ">") && tag[index] !== ">") index += 1;
  return index;
}

/** Length of the `=value` that may follow an attribute name at `from`,
 *  including surrounding whitespace. Zero when the attribute is bare. */
function assignmentLength(tag: string, from: number): number {
  let index = from;
  while (index < tag.length && isHtmlWhitespace(tag[index] ?? "")) index += 1;
  if (tag[index] !== "=") return 0;
  index += 1;
  while (index < tag.length && isHtmlWhitespace(tag[index] ?? "")) index += 1;
  return valueEnd(tag, index) - from;
}

/** True when `char` ends an attribute name rather than continuing it. */
function endsAttributeName(char: string | undefined): boolean {
  if (char === undefined) return true;
  return isHtmlWhitespace(char) || char === "=" || char === "/" || char === ">";
}

/** Cuts the proof out of the tag, taking the whitespace that separated it from
 *  the previous attribute. Trimming a trailing `\s+>` instead would be wrong:
 *  the first such run in `<span data-page="a >b" data-app-markup="…">` is inside
 *  a quoted VALUE, and collapsing it would rewrite the author's text. */
function removeMarkerAt(tag: string, at: number, length: number): string {
  let start = at;
  while (start > 0 && isHtmlWhitespace(tag[start - 1] ?? "")) start -= 1;
  return tag.slice(0, start) + tag.slice(at + length);
}

/** Removes the forbidden attributes from ONE tag's source text — unless the
 *  tag proves it is app markup, in which case only the proof is removed so it
 *  cannot leak into the document and be copied back in by an author. */
function stripFromTag(tag: string): string {
  const marker = trustedMarker();
  const at = marker === "" ? -1 : tag.indexOf(marker);
  if (at !== -1) return removeMarkerAt(tag, at, marker.length);
  const out: string[] = [];
  let index = 0;
  while (index < tag.length) {
    const rest = tag.slice(index);
    // Separator run: whitespace OR `/`. HTML's before-attribute-name state
    // treats a `/` that is not followed by `>` as a parse error and then
    // reads an attribute name anyway, so `<div /class="absolute">` really
    // does set a class — verified through marked + the sanitiser into the
    // DOM. Matching only whitespace left that bypass open (codex round 4,
    // P1). A terminal `/>` is untouched: nothing follows it to match as a
    // name, so it falls through to the byte copy below.
    const match = /^([ \t\n\f\r/]+)([A-Za-z_:][-A-Za-z0-9_:.]*)/.exec(rest);
    if (match === null) {
      out.push(tag[index] ?? "");
      index += 1;
      continue;
    }
    const [whole, , rawName] = match;
    const name = rawName ?? "";
    const nameEnd = index + whole.length;
    const span = whole.length + assignmentLength(tag, nameEnd);
    // The matched name must END here, or it is a longer name that merely
    // STARTS with a forbidden one. HTML attribute names run through
    // characters this regex does not accept — non-ASCII, NUL — so `classé`
    // is one attribute and not `class`, and stripping its prefix produced
    // `<divé=x>` out of `<div classé=x>` (codex round 8).
    if (FORBIDDEN.includes(name.toLowerCase()) && endsAttributeName(tag[nameEnd])) index += span;
    else {
      out.push(tag.slice(index, index + span));
      index += span;
    }
  }
  return out.join("");
}

/**
 * Removes `class` and `style` from every tag in an HTML fragment, leaving
 * text, comments and every other attribute byte-identical.
 *
 * Lexical on purpose: `marked` chunks raw HTML into pieces that are not
 * well-formed — an opening `<div …>` and its `</div>` arrive as separate
 * tokens — so parsing a chunk as a document and re-serialising it would
 * close the first and delete the second.
 */
export function stripPresentationAttributes(fragment: string): string {
  const out: string[] = [];
  let index = 0;
  while (index < fragment.length) {
    const char = fragment[index] ?? "";
    if (char !== "<") {
      out.push(char);
      index += 1;
      continue;
    }
    // Comments and doctype/CDATA are copied verbatim; they carry no
    // attributes and their contents must not be treated as tags. A comment
    // ends at `-->`, NOT at the first `>` — `<!-- <div class=x> <span
    // class=y> -->` was having its later text rewritten (codex round 3).
    if (fragment.startsWith("<!", index)) {
      const end = commentEnd(fragment, index);
      out.push(fragment.slice(index, end));
      index = end;
      continue;
    }
    if (!opensTag(fragment, index)) {
      out.push(char);
      index += 1;
      continue;
    }
    const end = tagEnd(fragment, index);
    out.push(stripFromTag(fragment.slice(index, end)));
    const name = openingTagName(fragment, index);
    if (RAW_TEXT_ELEMENTS.includes(name)) {
      // Copy the element's text content — and its close tag — verbatim.
      const rawEnd = rawTextEnd(fragment, end, name);
      out.push(fragment.slice(end, rawEnd));
      index = rawEnd;
      continue;
    }
    index = end;
  }
  return out.join("");
}

/** Marked extension applying the rule. Register in every marked setup that
 *  renders markdown the app did not write. */
export const rawHtmlPolicyExtension: MarkedExtension = {
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return stripPresentationAttributes(token.text);
    },
  },
};
