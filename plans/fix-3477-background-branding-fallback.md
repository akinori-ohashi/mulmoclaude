# Keep chart / mermaid backgrounds and slide branding on the PNG path (#3477)

The browser preview fell back to the PNG only for textSlide / markdown beats with a background image. mulmocast's
PNG render also paints `backgroundImage` (beat or `imageParams`) behind chart and mermaid beats, and draws
`branding` (beat or `slideParams`) on slide beats; `beatToHtml` carries neither, so those previews dropped them.

- Fall back for textSlide / markdown / chart / mermaid with a background, and slide with branding.
- A beat-level `null` switches the deck's setting off, as mulmocast resolves it.
- Drawing these in the browser instead is mulmocast-side work (receptron/mulmocast-cli).
