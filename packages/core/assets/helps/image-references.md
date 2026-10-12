# Image references in markdown / HTML

When you write a `.md` or `.html` file that embeds images, follow this convention so the file renders correctly both in the app and when opened directly from disk:

- ALWAYS use a **relative path** that resolves against the SOURCE FILE you are writing (the .md / .html itself). For images saved by `saveImage` (Gemini / canvas / image edit) the file lives at `artifacts/images/YYYY/MM/<id>.png` — write a relative climb from the source file. Example: from `data/wiki/pages/notes.md` use `../../../artifacts/images/2026/04/foo.png`.
- NEVER use an **absolute path** like `/artifacts/images/foo.png`. The app serves that prefix as a static mount, so it works in-app, but breaks the moment the same file is opened directly from disk via `file://` (where root-relative URLs resolve against the filesystem root, not the workspace).
- NEVER use a workspace-rooted, no-leading-slash form like `data/wiki/sources/foo.png` or `artifacts/images/foo.png` (without the leading `/`). The browser resolves it against the page URL and 404s.
- NEVER write `/api/files/raw?path=...` URLs. That is a runtime serving artifact, not a stored convention — it bakes the current server URL into the file and breaks if the route shape changes.

This applies to markdown image syntax (`![alt](path)`), HTML `<img src="path">`, and any other element that takes a path to an image (`<source>`, `<video poster>`, CSS `url()`).

Raw HTML tags work inside `.md` files too — use them when markdown's `![]()` can't express what you need (e.g. `<picture>` + `<source>` for art-direction / responsive images, `<video poster>` for thumbnailed video, inline `<img width>` for size control). Same path rules apply: write a relative climb from the `.md` file to the asset, not an absolute or workspace-rooted path.
