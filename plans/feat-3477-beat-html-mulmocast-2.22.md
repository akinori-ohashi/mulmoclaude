# Draw scripted beats, backgrounds and branding in the browser preview (#3477)

mulmocast 2.22.0 (receptron/mulmocast-cli#1642, #1643) gives `beatToHtml` what the PNG path added around a beat:
`backgroundImage` / `branding` / `resolveMediaUrl` options, and `documentCss` / `documentScript` on the fragment.

- Pass the deck's `imageParams.backgroundImage` and `slideParams.branding`, and a `resolveMediaUrl` that uses a url as
  written and turns base64 into a PNG `data:` URI, as the PNG path inlines it.
- Write `documentCss` before the fragment css (the PNG page puts the background first) and `documentScript` after
  the markup. That replaces the plugin's own `authorScriptTag` and drops the PNG fallback for `elements` / `animation`.
- Put the page's white background on `body` only, so it spreads to the canvas as in the PNG page; on `html` it hid a
  semi-transparent background's `body::before`.
- Still on the PNG path: a background or branding image with `kind: "path"` (the sandboxed iframe cannot read
  workspace files; serving them needs a host endpoint — separate work), and a chart / mermaid beat with a named `style`.
