# feat(#3125): copy button on fenced code blocks

## Goal

Every rendered markdown surface gets a per-code-block copy affordance that behaves the way
users already expect from ChatGPT / Claude / GitHub: a header strip on top of the block with
the language on the left and a copy control on the right, feedback on success.

Issue: https://github.com/receptron/mulmoclaude/issues/3125
Reference prototype (external contributor): https://github.com/IwAgri/mulmoclaude/tree/feat/code-block-copy-button

## What exists today

- `.copy-btn` in `src/plugins/textResponse/View.vue:121` copies the WHOLE message, not one block.
- Five surfaces render fenced code and have no per-block copy:
  `src/plugins/textResponse/View.vue`, `src/plugins/skill/View.vue`,
  `src/plugins/manageSkills/useSkillMarkdown.ts`, `src/plugins/wiki/components/WikiPageBody.vue`,
  `packages/plugins/markdown-plugin/src/plugins/markdown/View.vue`.
  The issue's file list names only the first four — the plugin's View has its OWN copy of
  `useMermaid`, so "wire it next to every `useMermaidRenderer` call" misses it.

## Decision: emit the markup in the marked renderer, not in a post-render DOM pass

The prototype attaches buttons by scanning the container after render (`onMounted` +
`watch(..., { flush: "post" })`, mirroring `useMermaidRenderer`). Rejected, for two reasons
that are specific to this codebase:

1. **Streaming.** `renderedHtml` in `textResponse/View.vue:212` is a `computed` over the
   growing response text, so `v-html` REPLACES the container's innerHTML on every chunk.
   A post-render pass therefore re-scans and re-inserts a header for every code block on
   every chunk — the `data-*-attached` idempotency guard cannot help, because the nodes it
   marked no longer exist. Markup emitted by the renderer is part of the same string Vue
   already writes, so it costs nothing extra.
2. **Coverage.** A renderer extension is registered once per marked setup (2 places) instead
   of once per viewer (5 places, and the 6th viewer someone adds later).

`markedHighlight` rewrites `token.text` to highlighted HTML and sets `token.escaped = true`
during `walkTokens`, so a `code` renderer registered AFTER it can emit the complete block
itself — this is already how `mermaidExtension` works. Registration order becomes:

```text
markedHighlightExtension  →  codeCopyExtension  →  mermaidExtension
```

`mermaidExtension` stays outermost so a ```mermaid fence short-circuits to its placeholder
and never reaches the copy wrapper. Everything else falls through to `codeCopyExtension`,
which emits the wrapper + header + the `<pre><code>` marked-highlight would have produced.

### Verified before writing code

- DOMPurify (`sanitizeMarkdownHtml`, strict defaults + the YouTube-iframe hook) passes the
  whole emitted shape through unchanged: `<div>`, `<span>`, `<button type data-code-copy
  aria-label title class>`, and the inline `<svg><rect><path>`. Probed against the real
  policy, not assumed.
- Tailwind v4: the host's vite root is the repo, so `packages/markdown-utils/src` is scanned.
  The markdown plugin's root is its own package, so it needs an `@source` line naming the
  extension file — the #2989 trap, same fix `collection-plugin/src/style.css` already uses.

### i18n stays live despite being baked at parse time

The extension reads its labels through a provider (`setCodeCopyLabelProvider`), exactly like
`setEmbedLocaleProvider` in `src/utils/markdown/setup.ts`. The provider reads the reactive
i18n locale, so the read happens INSIDE the `renderedHtml` computed's evaluation and Vue
tracks it — switching language re-renders the labels with no sweep and no observer.

## UI

```text
┌──────────────────────────────────────────────┐
│ typescript                          [copy]   │  ← header strip
├──────────────────────────────────────────────┤
│ const a = 1;                                 │  ← existing <pre><code class="hljs …">
└──────────────────────────────────────────────┘
```

- Copy control lives top-right (ChatGPT / Claude / GitHub all agree on the corner).
- **Always visible, not hover-to-reveal** — answers the issue's open question. Hover-only is
  GitHub's flavour, but this app is driven from touch through `docs/remote-host.md`'s mobile
  views, where `:hover` never fires and the control would be unreachable.
- Success feedback swaps the icon to a check for 2s and updates `aria-label`.
- Inline SVG rather than the `material-icons` font class: the font is imported by the HOST
  (`src/main.ts:23`), and the markup also ships inside a plugin package that another host may
  load. Self-contained markup has no such dependency.
- Copies `code.textContent` — the raw source, not the highlighted markup.

## Files

New:
- `packages/markdown-utils/src/markdown/codeCopyExtension.ts` — marked extension + label provider
- `packages/markdown-utils/src/markdown/codeCopyClipboard.ts` — one delegated click listener
- `test/utils/markdown/test_codeCopyExtension.ts`, `test/utils/markdown/test_codeCopyClipboard.ts`

Changed:
- `packages/markdown-utils/src/index.ts` — export both
- `src/utils/markdown/setup.ts` — register between highlight and mermaid, wire the provider,
  install the click handler
- `packages/plugins/markdown-plugin/src/plugins/markdown/View.vue` — same registration
- `packages/plugins/markdown-plugin/src/style.css` — `@source` for the extension file
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — `markdownCodeCopy.{copyLabel,copiedLabel}`
- `docs/shared-utils.md` — one row per new helper

## The marker has to be a secret (added after review)

The first cut used a bare `data-code-copy` attribute. That is forgeable: `marked`
passes an author's raw HTML straight through and DOMPurify's defaults keep
`<button>` and every `data-*`, so any rendered markdown — a cloned repository's
README, which is what `sanitizeMarkdownHtml` exists for — could mint a working
copy control. Measured against the real sanitizer: the spoof reached
`clipboard.writeText`, and with a `display:none` decoy block the reader saw
`npm install` while the clipboard took `curl … | bash`. Before this change
`navigator.clipboard` was not reachable from rendered markdown at all.

Structure cannot be the check, because an author can reproduce any structure.
Only a secret they cannot read works, and they cannot read this one because the
sanitizer strips scripts. So the attribute's VALUE is a nonce:

- CSPRNG only (`crypto.randomUUID`, else `getRandomValues`). No `Math.random`
  fallback — that is a weaker version of the thing being defended. With no CSPRNG
  the nonce is empty, the listener refuses it, and the button goes inert.
- It lives on the DOCUMENT, because host and plugin have separate module
  instances of this package and the document is all they share.
- A fresh document ADOPTS the renderer's current value instead of minting its
  own, so every document in a realm converges on one. Minting per document let a
  realm hold two and the renderer stamp the wrong one.

Deliberately NOT fixed here: a CSS overlay (`position:absolute` on author
markup) can still hide the real fence so the reader sees one command while the
genuine button copies another. It pre-dates this change — a manual selection over
the visible region is fooled identically — and `mathRender.ts` records the
decision to accept author-controlled positioning for this host. Banning inline
`style` app-wide is a maintainer call and its own PR.

## Verification

- `yarn test` (node:test + jsdom) — extension shape, mermaid pass-through, escaped/unescaped
  `token.text`, sanitizer survival, delegated copy + feedback + idempotent install.
- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build`.
- Run the app and copy from a real streamed response — build success is not behaviour.
