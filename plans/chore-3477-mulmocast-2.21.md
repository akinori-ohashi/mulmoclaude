# chore: take mulmocast 2.21 (chart / mermaid as deck figure slides) — #3477

## What changed upstream

receptron/mulmocast-cli#1634 / PR #1635 (mulmocast 2.21.0, `@mulmocast/deck` 2.1.0): `beatToHtml` now draws a
standalone `chart` / `mermaid` beat as a deck `figure` slide through `generateSlideFragment`, like `slide` beats.
The PNG path is unchanged.

## Changes here

- `mulmocast` `^2.21.0` and `@mulmocast/deck` `^2.1.0` (root, launcher, plugin devDependencies). Plugin peers stay
  at their floors (`mulmocast ^2.15.0`, `@mulmocast/deck ^2.0.2`): older versions still work, only with the old look.
- Lockfile: only the mulmocast and deck stanzas move; the two deck ranges are deduplicated to 2.1.0.
- The plugin's stray `dependencies: { "@mulmocast/deck" }` block (left by #3476) is removed — a host-provided package
  is `peer` + `dev` only (repo CLAUDE.md).
- `ops.ts` takes `MulmoStudioContext` from `mulmocast`, not `@mulmocast/types`: the types package inlines the deck
  slide types of its own build (no `figure`), so its copy no longer matches the context mulmocast 2.21 builds.
- Tailwind is loaded per mulmocast's docs/api.md table ("Providing Tailwind"): always for `slide` / `chart` /
  `mermaid` / `html_tailwind`, for `markdown` only with a layout object or a mermaid fence, never for `textSlide`.
  #3476 loaded it only for `html_tailwind`, so `slide` beats (and now chart / mermaid) rendered unstyled.
