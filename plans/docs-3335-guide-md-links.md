# docs: guide cross-links as `.md` (#3335)

## Problem

`docs/index.md` and `docs/guide/{ja,en}/*.md` link to each other with `.html` hrefs. Those
exist only on the built Pages site, so the same links 404 when reading the source on github.com.

## Change

- Rewrite every internal guide link from `X.html[#anchor]` to `X.md[#anchor]`. External
  links (`mulmoterminal.com`) stay as they are.
- Add `jekyll-relative-links` to `docs/Gemfile` and to `plugins:` in `docs/_config.yml`.
  Pages is built by `.github/workflows/pages.yml` with plain Jekyll 4 (not the `github-pages`
  gem), so the plugin is not on by default and must be declared, or the deployed site would
  start linking to `.md` files.

## Verification

Build the site as `pages.yml` does (`bundle exec jekyll build --baseurl /mulmoclaude`) and
check that the generated guide pages contain no `href` ending in `.md` that points into the
guide, that anchors survive, and that the kramdown `{: .btn …}` buttons still carry their classes.
