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
// It once had to make an exception. `[[wiki-link]]` used to be a rewrite of the
// markdown SOURCE, so its span arrived here indistinguishable from author HTML
// and needed an unforgeable per-render nonce to keep its class. Wiki links are
// a marked extension now (#3164), so nothing app-generated reaches this
// renderer and the whole mechanism is gone — which is the point: a security
// control with one fewer moving part, rather than one more.

import type { MarkedExtension, Tokens } from "marked";

/** Attributes an author may not set. Presentation only — this is not the
 *  XSS boundary, which stays with DOMPurify. */
const FORBIDDEN = ["class", "style"];

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

/** True when `char` ends a TAG name. Deliberately NOT `endsAttributeName`:
 *  that also stops at `=`, which the tokenizer's tag-name state keeps as part
 *  of the name, so reusing it would leave `<style=foo>` reading as `style`. */
function endsTagName(char: string | undefined): boolean {
  if (char === undefined) return true;
  return isHtmlWhitespace(char) || char === "/" || char === ">";
}

/** Name of the tag starting at `start`, lower-cased; "" for a closing tag
 *  or anything that is not a plain element name.
 *
 *  The name runs to whitespace, `/` or `>` — HTML's own boundary — and not to
 *  the end of a `[A-Za-z0-9-]` run. Stopping early made a name that merely
 *  BEGINS with a raw-text one read as that element: `<style:foo>` came back as
 *  `style`, so its contents were copied verbatim and a nested
 *  `<pre class="absolute" style="position:absolute">` survived (codex round 17).
 *  The attribute-name boundary had the identical bug in round 8 (`classé`); this
 *  is the same rule one level up. */
function openingTagName(fragment: string, start: number): string {
  if (fragment[start] !== "<" || !isAsciiLetter(fragment[start + 1] ?? "")) return "";
  let index = start + 1;
  while (index < fragment.length && !endsTagName(fragment[index])) index += 1;
  return fragment.slice(start + 1, index).toLowerCase();
}

/** Index just past a `<!…>` run: `-->` for a real comment, the first `>`
 *  for a doctype or bogus comment.
 *
 *  `<!-->` and `<!--->` are COMPLETE empty comments — the spec's
 *  abrupt-closing-of-empty-comment, reached from comment-start and
 *  comment-start-dash — so the markup after them is LIVE. Searching only for
 *  `-->` from `start + 4` misses both, and the scanner then copied the rest of
 *  the fragment verbatim: `<!---><pre class="absolute inset-0 bg-white">` kept
 *  its class all the way through marked and the sanitiser, which is the overlay
 *  this file exists to stop (codex round 21, P1). */
function commentEnd(fragment: string, start: number): number {
  if (fragment.startsWith("<!--", start)) {
    if (fragment[start + 4] === ">") return start + 5;
    if (fragment[start + 4] === "-" && fragment[start + 5] === ">") return start + 6;
    return commentBodyEnd(fragment, start + 4);
  }
  const close = fragment.indexOf(">", start);
  return close === -1 ? fragment.length : close + 1;
}

/** Index just past whichever closes the comment first: `-->`, or `--!>` — the
 *  spec's incorrectly-closed-comment, reached from comment-end-bang. Knowing
 *  only `-->` made `<!--a--!>` read as unterminated, so the live markup after it
 *  was swallowed and `<div class="absolute inset-0" style="position:absolute">`
 *  kept both attributes. Same shape as the `<!--->` bypass, one variant along. */
function commentBodyEnd(fragment: string, from: number): number {
  const plain = fragment.indexOf("-->", from);
  const bang = fragment.indexOf("--!>", from);
  if (plain === -1 && bang === -1) return fragment.length;
  if (bang === -1 || (plain !== -1 && plain <= bang)) return plain + 3;
  return bang + 4;
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

/** True when `</` at `index` is NOT an end tag. HTML's end-tag-open state takes
 *  an ASCII letter and nothing else: `>` drops the token, EOF emits the two
 *  characters, and anything else opens a BOGUS COMMENT that runs to the next
 *  `>`. All three want the bytes copied through untouched — and the last one
 *  matters, because the text inside is comment content a parser never treats as
 *  markup: `</é <span class=x>>` was having its inner span rewritten
 *  (codex rounds 19-20). */
function isBogusEndTag(fragment: string, index: number): boolean {
  return fragment[index + 1] === "/" && !isAsciiLetter(fragment[index + 2] ?? "");
}

/** True when `<?` opens a bogus comment. Tag-open takes `?` as an
 *  unexpected-question-mark-instead-of-tag-name parse error and reconsumes in
 *  bogus comment state, so everything to the next `>` is comment TEXT. Copying
 *  only the `<` and scanning on rewrote that text: `<?x <span class=y>>` lost
 *  the class a parser keeps (codex round 23). Every other non-letter after `<`
 *  is literal text and needs no special case — the bytes are copied either way. */
function isProcessingInstruction(fragment: string, index: number): boolean {
  return fragment[index + 1] === "?";
}

/** True when `<` at `index` opens a tag rather than being literal text.
 *  `a < b` in prose must survive untouched.
 *
 *  A closing tag needs an ASCII LETTER after the `/`, which is HTML's own rule:
 *  end-tag-open only enters end-tag-name for a letter, and treats anything else
 *  as a bogus comment. Accepting any `</` rewrote parser COMMENT text as if it
 *  were a tag — `</ class=x>` came back as `</>`, while a parser reads the
 *  original as `<!-- class=x-->` (codex round 19). Left alone the bytes are
 *  copied through and the parser still sees its comment. */
function opensTag(fragment: string, index: number): boolean {
  const next = fragment[index + 1];
  if (next === undefined) return false;
  if (next === "/") return isAsciiLetter(fragment[index + 2] ?? "");
  return isAsciiLetter(next);
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

/** How much of the tag an attribute's `=value` occupies, and whether that
 *  value was QUOTED — which decides whether the next attribute name may begin
 *  with no separator at all. */
interface Assignment {
  length: number;
  quoted: boolean;
}

/** Length of the `=value` that may follow an attribute name at `from`,
 *  including surrounding whitespace. Zero when the attribute is bare. */
function assignmentLength(tag: string, from: number): Assignment {
  let index = from;
  while (index < tag.length && isHtmlWhitespace(tag[index] ?? "")) index += 1;
  if (tag[index] !== "=") return { length: 0, quoted: false };
  index += 1;
  while (index < tag.length && isHtmlWhitespace(tag[index] ?? "")) index += 1;
  const first = tag[index];
  return { length: valueEnd(tag, index) - from, quoted: first === '"' || first === "'" };
}

/** True when `char` ends an attribute name rather than continuing it. */
function endsAttributeName(char: string | undefined): boolean {
  if (char === undefined) return true;
  return isHtmlWhitespace(char) || char === "=" || char === "/" || char === ">";
}

/** Index just past `<`, an optional `/`, and the tag name.
 *
 *  The attribute walk has to START here. Beginning at the `<` instead made the
 *  NAME of a closing tag read as an attribute, because `/` is an attribute
 *  separator: `</style=foo>` matched separator `/` + name `style`, which is
 *  FORBIDDEN, and the tag was eaten down to `<>`. It stayed invisible only
 *  because a real `</style>` is reached through `rawTextEnd` and never comes
 *  here — a name that merely begins with a raw-text one does. */
function tagNameEnd(tag: string): number {
  let index = tag[1] === "/" ? 2 : 1;
  while (index < tag.length && !endsTagName(tag[index])) index += 1;
  return index;
}

/** Index just past a run of separators — whitespace, or a `/` that is not
 *  closing the tag. HTML's before-attribute-name state treats such a `/` as a
 *  parse error and then reads an attribute name anyway, so
 *  `<div /class="absolute">` really does set a class (codex round 4, P1). */
function separatorEnd(tag: string, from: number): number {
  let index = from;
  while (index < tag.length && (isHtmlWhitespace(tag[index] ?? "") || tag[index] === "/")) index += 1;
  return index;
}

/** One attribute's extent, read the way the tokenizer reads it: the name runs
 *  to whitespace, `=`, `/` or `>` whatever it STARTS with. Requiring a name to
 *  start `[A-Za-z_:]` and byte-copying past the ones that did not was the root
 *  of three separate bypasses, because a byte copy loses the position and the
 *  attribute AFTER the unrecognised one stopped being seen at all:
 *  `<div 1="a"class="absolute">` kept its class (round 18). */
interface Attribute {
  end: number;
  name: string;
}

function readAttribute(tag: string, nameStart: number): Attribute {
  // An `=` in before-attribute-name is a parse error that becomes the name's
  // FIRST character, not a value separator — `<div ="x" class="y">` really has
  // an attribute called `="x"` and then a separate `class`. Treating it as a
  // boundary made the walk abandon the rest of the tag, so that `class`
  // survived (found re-auditing the rewrite against the tokenizer, round 19).
  let index = nameStart + (tag[nameStart] === "=" ? 1 : 0);
  while (index < tag.length && !endsAttributeName(tag[index])) index += 1;
  return { end: index + assignmentLength(tag, index).length, name: tag.slice(nameStart, index) };
}

/** Whether the separators before a dropped attribute may go with it. They may,
 *  unless the next attribute has none of its own — which HTML allows directly
 *  after a quoted value, and where dropping them fuses `<div class="x"id="a">`
 *  into `<divid="a">`. */
function separatorsAreSpare(tag: string, after: number): boolean {
  const next = tag[after];
  return next === undefined || next === ">" || next === "/" || isHtmlWhitespace(next);
}

/** Removes the forbidden attributes from ONE tag's source text. */
function stripFromTag(tag: string): string {
  let index = tagNameEnd(tag);
  const out: string[] = [tag.slice(0, index)];
  while (index < tag.length) {
    const nameStart = separatorEnd(tag, index);
    if (nameStart >= tag.length || tag[nameStart] === ">") {
      out.push(tag.slice(index));
      break;
    }
    const attribute = readAttribute(tag, nameStart);
    if (FORBIDDEN.includes(attribute.name.toLowerCase())) out.push(separatorsAreSpare(tag, attribute.end) ? "" : " ");
    else out.push(tag.slice(index, attribute.end));
    index = attribute.end;
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
    // Comments, doctype, CDATA, bogus end tags and `<?…>` processing
    // instructions are copied verbatim; they carry no attributes and their
    // contents must not be treated as tags.
    //
    // `<![CDATA[` is read as HTML's bogus comment — ending at the first `>` —
    // which is right everywhere markdown raw HTML actually lands. Inside
    // FOREIGN content (`<svg>`, `<math>`) a parser would instead run it to
    // `]]>`, so a `>` in the body diverges. Not fixed on purpose: knowing
    // whether we are in foreign content needs element state that cannot survive
    // marked handing raw HTML over in chunks, and the divergence only ever
    // rewrites text a parser keeps — it cannot let an attribute through.
    // Where each one ENDS is the whole question, and both directions have been
    // wrong. Too early: a comment runs to `-->`, not to the first `>`, or its
    // later text gets rewritten (round 3). Too late: `<!-->`, `<!--->` and
    // `--!>` all end a comment where a `-->` search does not find one, and the
    // live markup after them was swallowed and kept its class (rounds 21-22).
    // `commentEnd` owns every one of those rules.
    if (fragment.startsWith("<!", index) || isBogusEndTag(fragment, index) || isProcessingInstruction(fragment, index)) {
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
