// Unit tests for the `[[wiki-link]]` TOKENIZER.
//
// The thing under test is a parser, so these drive it through real `marked`
// and assert on what it produced — both directions. A tokenizer that fires
// where it must not is as much a bug as one that fails to fire: the version
// this replaces fired inside code fences, and the reader saw the span's source
// (with a live nonce in it) instead of their own text (#3164).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Marked } from "marked";
import { WIKI_LINK_PATTERN, parseWikiLink, renderWikiLinks } from "@mulmoclaude/core/wiki";
import { wikiLinkExtension, withWikiLinks } from "../../../src/utils/markdown/wikiLinks.js";
import { wikiEmbedExtension, registerWikiEmbed } from "../../../src/utils/markdown/wikiEmbeds.js";

/** A parse with links enabled, through a fresh instance so no test can inherit
 *  another's registration order. */
function render(source: string, wire: (instance: Marked) => void = (instance) => instance.use(wikiLinkExtension)): string {
  const instance = new Marked();
  wire(instance);
  return withWikiLinks(() => {
    const html = instance.parse(source);
    assert.equal(typeof html, "string", "the wiki pipeline relies on a synchronous parse");
    return typeof html === "string" ? html : "";
  });
}

/** The rendered link as a real parser sees it. Renderer output has to be
 *  checked through a parser, not against raw HTML: `a&b` is correct output as
 *  `a&amp;b`, and a string comparison would call that a failure. */
function linkElement(html: string): Element | null {
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document.querySelector("span.wiki-link");
}

/** The rendered span for one link, as the styling and `WikiPageBody`'s
 *  `closest(".wiki-link")` handler both require it. */
const span = (page: string, text: string): string => `<span class="wiki-link" data-page="${page}">${text}</span>`;

describe("wikiLink tokenizer — fires", () => {
  const fires: { name: string; source: string; expected: string }[] = [
    { name: "a bare link", source: "see [[Home]] now", expected: span("Home", "Home") },
    { name: "target|display", source: "[[home|Home Page]]", expected: span("home", "Home Page") },
    { name: "only the FIRST pipe splits", source: "[[a|b|c]]", expected: span("a", "b|c") },
    { name: "the target is trimmed, the display is not", source: "[[  foo  |  Bar  ]]", expected: span("foo", "  Bar  ") },
    { name: "two links in a row", source: "[[a]][[b]]", expected: span("a", "a") + span("b", "b") },
    { name: "a link inside a list item", source: "- item: [[x]]", expected: span("x", "x") },
    { name: "a link inside emphasis", source: "*[[x]]*", expected: span("x", "x") },
    { name: "a non-ASCII title", source: "[[キース・ラボイス]]", expected: span("キース・ラボイス", "キース・ラボイス") },
    { name: "an empty target keeps the display", source: "[[|shown]]", expected: span("", "shown") },
    { name: "an empty display keeps the target", source: "[[foo|]]", expected: span("foo", "") },
  ];
  fires.forEach(({ name, source, expected }) => {
    it(name, () => assert.match(render(source), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  });

  it("a link surrounded by an outer bracket keeps the bracket", () => {
    // `[[[foo]]]` is `[` + a link, not a link to `[foo`.
    assert.match(render("[[[foo]]]"), /\[<span class="wiki-link" data-page="foo">foo<\/span>\]/);
  });
});

describe("wikiLink tokenizer — does NOT fire", () => {
  const inert: { name: string; source: string }[] = [
    { name: "an empty body", source: "[[]]" },
    { name: "an unclosed opener", source: "open [[ but no close" },
    { name: "a bare `]` inside the body", source: "x [[foo]bar]] y" },
    { name: "a newline inside the body", source: "[[foo\nbar]]" },
    { name: "a body past the shared length cap", source: `[[${"a".repeat(201)}]]` },
    { name: "a single bracket pair", source: "[foo]" },
  ];
  inert.forEach(({ name, source }) => {
    it(name, () => assert.doesNotMatch(render(source), /class="wiki-link"/));
  });
});

// The regression this file exists for. A pre-parse string rewrite cannot see
// that it is inside a fence; a tokenizer never gets there.
describe("wikiLink tokenizer — code is never touched", () => {
  const code: { name: string; source: string }[] = [
    { name: "an inline code span", source: "`[[Home]]` inline" },
    { name: "a fenced block", source: "```\n[[Home]]\n```" },
    { name: "a fenced block with a language", source: "```sh\n[[Home]]\n```" },
    { name: "an indented block", source: "    [[Home]]\n" },
    { name: "a double-backtick span", source: "``[[Home]]``" },
  ];
  code.forEach(({ name, source }) => {
    it(`${name} keeps the literal text and emits no span`, () => {
      const html = render(source);
      assert.doesNotMatch(html, /class="wiki-link"/, "the tokenizer must not reach code content");
      assert.match(html, /\[\[Home\]\]/, "the reader must see what they typed");
      assert.doesNotMatch(html, /data-app-markup/, "no app plumbing may appear in code either");
    });
  });
});

describe("wikiLink tokenizer — escaping", () => {
  it("a quote in the target cannot open a new attribute", () => {
    // The text `onclick=…` survives INSIDE the value — it is part of the page
    // title and harmless there. What must not happen is it becoming an
    // attribute of its own, which only a parser can tell you.
    const element = linkElement(render(`[[foo"onclick=alert(1)//]]`));
    assert.ok(element);
    assert.equal(element.getAttribute("onclick"), null);
    assert.deepEqual(element.getAttributeNames().sort(), ["class", "data-page"]);
    assert.equal(element.getAttribute("data-page"), 'foo"onclick=alert(1)//');
  });

  it("escapes markup in the display half", () => {
    const html = render("[[foo|<img src=x onerror=alert(1)>]]");
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it("an ampersand survives as one character, not as an entity", () => {
    const element = linkElement(render("[[a&b|c&d]]"));
    assert.ok(element);
    assert.equal(element.getAttribute("data-page"), "a&b");
    assert.equal(element.textContent, "c&d");
  });
});

describe("wikiLink tokenizer — scope", () => {
  it("is inert outside the window, so chat markdown keeps `[[x]]` literal", () => {
    const instance = new Marked();
    instance.use(wikiLinkExtension);
    const html = String(instance.parse("see [[Home]] now"));
    assert.doesNotMatch(html, /class="wiki-link"/);
    assert.match(html, /\[\[Home\]\]/);
  });

  it("closes the window even when the parse throws", () => {
    assert.throws(() =>
      withWikiLinks(() => {
        throw new Error("boom");
      }),
    );
    const instance = new Marked();
    instance.use(wikiLinkExtension);
    assert.doesNotMatch(String(instance.parse("[[Home]]")), /class="wiki-link"/);
  });

  it("a nested render does not disable the outer one's links", () => {
    const inner = withWikiLinks(() => "inner done");
    assert.equal(inner, "inner done");
    const html = withWikiLinks(() => {
      withWikiLinks(() => "nested");
      const instance = new Marked();
      instance.use(wikiLinkExtension);
      return String(instance.parse("[[Home]]"));
    });
    assert.match(html, /class="wiki-link"/);
  });
});

describe("wikiLink tokenizer — ordering against wikiEmbed", () => {
  registerWikiEmbed({ prefix: "testembed", render: (embedId: string) => `<a class="wiki-embed" data-id="${embedId}">${embedId}</a>` });

  // Both tokenizers start at `[[`, and marked tries the MOST RECENTLY
  // registered first — measured, not assumed. Registering links last let
  // `[[testembed:x]]` render as a link to a page of that name.
  const production = (instance: Marked): void => {
    instance.use(wikiLinkExtension);
    instance.use(wikiEmbedExtension);
  };

  it("an embed is still an embed", () => {
    const html = render("[[testembed:B00ICN066A]]", production);
    assert.match(html, /class="wiki-embed"/);
    assert.doesNotMatch(html, /class="wiki-link"/);
  });

  it("a plain link beside an embed still renders as a link", () => {
    const html = render("[[testembed:X]] and [[Home]]", production);
    assert.match(html, /class="wiki-embed"/);
    assert.match(html, /<span class="wiki-link" data-page="Home">/);
  });

  it("an UNREGISTERED prefix falls through to a wiki link", () => {
    // `[[foo:bar]]` with no handler is a page title containing a colon, not a
    // broken embed — the embed tokenizer declines and the link one takes it.
    const html = render("[[nosuchprefix:bar]]", production);
    assert.match(html, /<span class="wiki-link" data-page="nosuchprefix:bar">/);
  });
});

// The tokenizer must accept exactly what the lint / graph / backlinks accept.
// A link that renders clickable but that `WIKI_LINK_PATTERN` never matches is a
// page the graph cannot see.
describe("wikiLink tokenizer — parity with the shared pattern", () => {
  const bodies = ["Home", "a|b", "  spaced  ", "キース", "a&b", "", "a]b", "a[b", "a\nb", "a".repeat(200), "a".repeat(201), "x".repeat(1), "a:b", "a-b_c.d"];
  bodies.forEach((body) => {
    const label = body.length > 24 ? `${body.slice(0, 12)}…(${body.length})` : body;
    it(`agrees on ${JSON.stringify(label)}`, () => {
      const source = `[[${body}]]`;
      const patternMatches = new RegExp(`^(?:${WIKI_LINK_PATTERN.source})$`).test(source);
      const rendered = /class="wiki-link"/.test(render(source));
      assert.equal(rendered, patternMatches, "renderer and shared pattern must accept the same bodies");
      if (patternMatches) {
        const element = linkElement(render(source));
        assert.ok(element);
        assert.equal(element.getAttribute("data-page"), parseWikiLink(body).target);
      }
    });
  });
});

// "It behaves the same" is proved by running both, not by reading. The old
// implementation is still exported from `@mulmoclaude/core/wiki` (MulmoTerminal
// uses it), so the差分 can be run for real rather than argued — and the
// generator plus the property outlive the harness, which is why they live here.
describe("wikiLink tokenizer — differential against the string walker it replaces", () => {
  const targets = ["Home", "a b", "  pad  ", "キース", "a&b", "a|b", "a|b|c", "", "a:b", "x".repeat(200)];
  const contexts = [
    (link: string) => link,
    (link: string) => `prose ${link} more`,
    (link: string) => `- item ${link}`,
    (link: string) => `**${link}**`,
    (link: string) => `${link}${link}`,
    (link: string) => `[other](/x) ${link}`,
  ];

  const inputs = targets.flatMap((target) => contexts.map((wrap) => wrap(`[[${target}]]`)));

  it("produces the same links as `renderWikiLinks` outside code, over generated inputs", () => {
    const divergences: string[] = [];
    inputs.forEach((source) => {
      const viaExtension = linkElement(render(source));
      const viaWalker = new JSDOM(`<!doctype html><body>${renderWikiLinks(source)}</body></html>`).window.document.querySelector("span.wiki-link");
      const same =
        (viaExtension === null) === (viaWalker === null) &&
        (viaExtension === null ||
          (viaExtension.getAttribute("data-page") === viaWalker?.getAttribute("data-page") && viaExtension.textContent === viaWalker?.textContent));
      if (!same) divergences.push(source);
    });
    assert.ok(inputs.length >= 50, `the generator collapsed to ${inputs.length} inputs`);
    assert.deepEqual(divergences, [], `diverged on ${divergences.length} of ${inputs.length}: ${JSON.stringify(divergences[0])}`);
  });

  it("and DIFFERS inside code, which is the whole point of the change", () => {
    const source = "`[[Home]]`";
    assert.doesNotMatch(render(source), /class="wiki-link"/, "the extension leaves code alone");
    assert.match(renderWikiLinks(source), /class="wiki-link"/, "the walker did not — that is the bug being fixed");
  });
});
