# fix(#3213): a `.srt` is text, and an unpreviewable file is downloadable

## The report

A `.srt` written into the workspace shows "Binary file — preview not supported"
in the Files view, and the only affordance offered — "Open in OS" — answers
"Failed to launch OS file handler". The reporter runs MulmoClaude inside WSL2
under Docker Desktop on a Windows host.

## Two separate defects behind one symptom

**1. `.srt` is plain UTF-8 and was classified `binary`.** `classify()` in
`server/api/routes/files.ts` is extension-based, and the extension was not in
`TEXT_EXTENSIONS`.

**2. The fallback for an unpreviewable file cannot work on that deployment at
all.** `POST /api/files/open` spawns `open` / `xdg-open` / `explorer.exe` on the
**server's** host. In a container, or on any remote host, there is no desktop
session there to hand the file to — so the button is not flaky, it is
structurally wrong for that deployment, and no genuinely binary file (`.xlsx`,
`.zip`, a HEIC photo) can be got out of the workspace through the UI.

Both were confirmed by reading the one call chain: `GET /api/files/content` →
`classify(absPath)` → `decideContentResponse("binary", …)` → the
`v-else` branch of `FileContentRenderer.vue`, whose only control is
"Open in OS".

## What changed

### The text/binary policy moved to its own module

`server/utils/files/text-extensions.ts` now owns `TEXT_EXTENSIONS`, grouped by
what each group is (docs, subtitles, playlists, data/config, markup, source,
shell, build, patches, generated artifacts) and carrying the reasons for the
exclusions. The set is what decides three things at once — preview, the
`/api/files/content` write gate, and whether a file falls to the binary
fallback — so it is worth a file and a spec of its own rather than a literal
buried in a route.

`classify()` itself is unchanged: it still asks the same question of the same
set, in the same order.

### The candidates were surveyed, not guessed

Four sources, in descending order of authority:

- **A real workspace** (`~/mulmoclaude`, enumerated by extension). This is
  where `.xsd`, `.map`, `.rules`, `.utf8` and — most telling — `.shape` turned
  up: ShapeScript source that **this product writes itself** into
  `artifacts/shapes/` and then refused to display. `file(1)` confirms UTF-8.
- **This repo's own MIME table** (`server/utils/files/attachment-store.ts`),
  which already names `.bmp`, `.avif`, `.toml` and `.xml` on upload — so the
  Files view calling them binary was a gap between two tables, not a policy.
- **`mime-db`**, for registered text types (`.vtt`, `.xsd`, `.ics`, `.gpx`,
  `.geojson`, `.ipynb`, the XML family).
- **`highlight.js`'s language aliases**, for the mainstream source languages.

The last two are cross-checks only, never the mechanism: `mime-db` types `.ts`
as `video/mp2t`, so a MIME lookup would classify every TypeScript file in the
workspace as a video stream. That trap is recorded in the module header, along
with why `.plist` and `.rtf` stay out (text only sometimes) and why every
credential-shaped extension does.

### Images: the browser-renderable gap

`.bmp` / `.avif` / `.ico` joined `IMAGE_EXTENSIONS` and `MIME_BY_EXT`.
`.heic` / `.heif` / `.tif` deliberately did **not** — no browser renders them,
so claiming `image` would render a broken `<img>`; they reach the user through
the new Download button instead.

### An extensionless-credential gap found while surveying

`classify` answers `text` for every name with no extname, so the basename
denylist is the only thing standing between `/api/files/content` and a
credential file that carries no extension. `.netrc`, its Windows spelling
`_netrc`, and `.git-credentials` were not on it. They are now.

This is not part of #3213's symptom — it was found while establishing which
extensions are safe to add — but it lives in the same denylist the survey had
to read, and leaving it open while widening the text set next to it would have
been the wrong order.

### A download that needs nothing of the server's desktop

`src/composables/useRawFileDownload.ts` fetches the bytes from
`/api/files/raw` and hands them to the browser, mirroring `useSharePack`'s
existing blob-save pattern and `useOpenInOs`'s reset-on-navigation contract.
`FileContentRenderer.vue`'s fallback shows it **before** "Open in OS", because
it is the one that works everywhere.

A `fetch` + blob rather than an `<a href download>` on purpose: the anchor form
has no error channel, so a refusal (`413` past the raw size cap, `400` on a
sensitive path) would be written to disk under the file's own name and arrive
looking like the file.

## What this does not fix

- A file past the raw route's size cap still cannot be downloaded — the route
  answers 413 and the button reports the failure. Raising that cap is a
  separate decision about streaming to disk.
- Content sniffing (no NUL bytes + valid UTF-8 ⇒ text) would remove the need to
  maintain a list at all for the read path. It cannot replace the list for the
  write gate, which classifies paths that do not exist yet, so it is a possible
  addition rather than a replacement.

## Verification

- `classify` gained per-group cases for the subtitle family, the surveyed
  workspace extensions, the newly renderable images, and — in both directions —
  the containers, the credential-shaped extensions and the unrenderable image
  formats that must stay `binary`.
- `test/utils/files/test_textExtensions.ts` pins the module's stated rules:
  lower-case dot-prefixed entries, no secret-shaped extension, no archive, no
  sometimes-text format, and no overlap with the image/audio/video branches
  (`classify` checks text first, so an overlap would silently break a working
  preview).
- `test/composables/test_useRawFileDownload.ts` covers the request URL, the
  saved basename, the refused-response path (asserting nothing is saved), the
  thrown-request path and the reset-on-navigation transitions.
- The Files view was driven in a browser against a running server for both
  halves — see the PR for what was exercised.
