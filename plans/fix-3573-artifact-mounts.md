# fix: `/artifacts/{images,html,svg}` serve only what is inside the workspace (#3573)

Follow-up to `plans/fix-3573-verified-open.md` (PR #3580), which made plugin FileOps
race-verified. This PR moves the three static artifact mounts in `server/index.ts`.

## Problem (reproduced on `main` at 2.9.0)

Each mount realpaths its own folder (`makeCachedRealpath(WORKSPACE_PATHS.images)`), checks the
request against that, then hands the path to `express.static`. Two holes:

1. **A symlinked folder becomes the root.** Replacing `artifacts/images` (or `html`, `svg`, or
   `artifacts/` itself) with a link to a host folder makes that folder the trusted root, so every
   file in it with an allowed extension is served. Reproduced with a real server: a link to an
   outside folder served `secret.png`, `secret.html` and `secret.svg` with 200. The agent can make
   the link from inside the Docker sandbox; the host resolves its target.
2. **Check, then `express.static` opens by path.** A component swapped between the two is
   followed.

## Fix

- The anchor is the workspace realpath; the mount folder is re-resolved under it per request
  (`scopeRealpath`), so a folder that is, or becomes, a link out is a 404.
- The file is opened with `openVerifiedWithinScope` (open, then prove the descriptor is the
  in-scope file) and served from the handle — never re-opened by path.
- `sendFileHandle` replaces `express.static` for these mounts: `Content-Type` by extension (kept
  when the mount set one, as `send` does), `Content-Length`, `Last-Modified`, weak `ETag`,
  `If-Match` / `If-Unmodified-Since` (412), conditional GET (304), single `Range` with `If-Range`
  by tag or date (206 / 416, needed for video and audio seeking), `HEAD`, in `send`'s order.
  Multi-range requests get the whole file, as `send` does with combined ranges it cannot serve.
  412 / 304 / 416 carry no body, like the 404s these mounts already answer (`send` writes an HTML
  error page for 412 / 416; nothing here renders one).
- The HTML document path (`readAndInjectHtmlArtifact`) reads through the verified handle too.
- Dotfiles are refused in the guard on all three mounts (the images mount used to rely on
  `express.static`'s `dotfiles: "deny"`, which answered 403; it is now 404 like the others).
- A directory or other non-regular file under an allowed name is a 404.

## Not in this PR (each its own PR, revertable alone)

- `store-resolvers` (image / attachment stores): same symlinked-root class, cached realpath.
- Workspace-rooted readers — `files.ts`, `pdf.ts`, `thumbnail-store`, `packHtml`: the root is the
  workspace itself, so only the race applies.
- `mulmoscript-plugin` ops (stories root) — a plugin package with its own publish.
- `exportShapeScriptUsdz` already refuses an `artifacts/` that leads out; race only.
- `runtime-plugin` assets: the root is a server-registered cache path, not agent-chosen.
- `/htmlfile` has no containment root by design (presentHtml's `path` form).

## Tests

- `test/utils/files/test_artifactMount.ts`: a real express app with the three mounts' guard over
  a temp workspace — in-scope file served; a mount folder, or `artifacts/`, linked out → 404; a
  file link out → 404; dotfile, traversal, directory → 404; Range 206 / 416, HEAD, 304.
- `test/server/test_readAndInjectHtmlArtifact.ts`: takes a scope; a linked-out folder → null.
