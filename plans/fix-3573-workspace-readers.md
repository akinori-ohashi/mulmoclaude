# fix: PDF export, HTML share and remote-view thumbnails read through the verified open (#3573)

Follow-up to `plans/fix-3573-photo-locations.md`. This PR moves three of the workspace-rooted readers; `files.ts` is
its own PR.

## Problem

All three checked a path with `resolveWithinRoot` (realpath, containment) and then read it again by path:

- `inlineImages` (`server/api/routes/pdf.ts`): PDF export and the markdown zip share embed local images as data URIs.
- `packHtmlBundle` (`server/utils/share/packHtml.ts`): the HTML zip share reads the page and its assets.
- `createThumbnailResolver` (`server/utils/files/thumbnail-store.ts`): remote-view thumbnails.

Their anchor is the workspace itself, so the symlinked-root hole of the earlier groups does not apply. What is left is
the race in the issue: a path swapped for a link between the check and the read (inferred, not reproduced).

Observed on `main`: the by-path read also opens a named pipe. `mkfifo artifacts/images/pipe.png` plus an
`<img src="/artifacts/images/pipe.png">` makes `inlineImages` block in `readFileSync`, which stops the server's event
loop. The same pipe makes `packHtmlBundle` wait forever. Thumbnails were already safe, because they `stat` first.

## Fix

- `readArtifactFile(scope, relPath)` in `artifactMount.ts`: the bytes of a regular file through `openArtifactFile`
  (verified open plus a regular-file check on the handle), or null. `artifactScope(root, "")` is the workspace scope.
- `packHtml`: page and assets go through it. The lexical `path.relative` check stays in front, because it is the form
  CodeQL recognises.
- `thumbnail-store`: one verified handle gives both the `mtime` for the cache key and the bytes.
- `pdf.ts`: the URL transform is synchronous, so `inlineImages` collects the URLs first, reads them asynchronously, and
  then substitutes. It is now `async`; `renderMarpHtml` and `renderMarkdownHtml` await it. The module no longer calls
  `realpathSync` on the workspace when it loads.
- `readBinarySafeSync` loses its only caller and is removed.

## Behaviour changes

- A named pipe, directory or other non-regular file is skipped instead of being read.
- `packHtmlBundle` on a directory throws `HTML not found or outside workspace` instead of `EISDIR`.
- The MIME type of an inlined image comes from the name in the page. Before, it came from the name of the link's
  target, for a link inside the workspace.

## Verified

- Old and new code ran side by side over generated pages, `sourceDir` values and paths: links in and out, a directory,
  dotfiles, query strings and fragments, and srcset. The harness is in the PR description. The only difference was the
  directory message above.
- On the old code, the new named-pipe tests for `packHtml` time out.

## Not in this PR

- `files.ts`, `mulmoscript-plugin` ops, `exportShapeScriptUsdz`, `runtime-plugin` assets.
- `readAndInjectHtmlArtifact` and `makeStoreFiles().read` repeat `readArtifactFile`'s body. They are left as they are, so
  this PR touches only the readers it moves.
