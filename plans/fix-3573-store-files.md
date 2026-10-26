# fix: image / attachment stores read and write only inside the workspace (#3573)

Follow-up to `plans/fix-3573-artifact-mounts.md` (PR #3595). This PR moves the `store-resolvers` group.

## Problem (reproduced on `main` at `1387d8a8f`)

`makeStoreResolvers` realpath'd the store folder once (`artifacts/images`, `data/attachments`), cached it for the
process, and confined paths to that. With the store folder replaced by a link to an outside folder, all seven store
operations reached it: `loadImageBase64`, `loadAttachmentBytes` and `attachmentExists` read `secret.*` there;
`overwriteImage` overwrote it; `saveImage`, `saveAttachment` and `saveCompanion` wrote new files into it
(`saveImage` / `saveAttachment` never went through the resolver at all). Reached from `editImage`'s `imagePaths`
(bytes go to the image model and back into the workspace), chat attachments, canvas save / update and uploads.

## Fix

- `store-files.ts` (`makeStoreFiles`) replaces `store-resolvers.ts`. The anchor is the workspace: `storeTrustedRoot`
  takes the store root minus its `dirPrefix`, so tests that repoint `WORKSPACE_PATHS.<dir>` keep working.
- Reads (`read`, `isFile`) open through `openArtifactFile` (verified open + regular-file check), never by path.
- Writes go through `makeConfinedFileOps({ root, trustedRoot }).write` — the plugin FileOps' verified write, which
  creates the store folder only inside the workspace. All four write functions use it, including the two new-file saves.
- `storeRelativePath` (pure) does the lexical check first: empty, absolute, drive-qualified, NUL, escaping → refused.

Behaviour changes: a symlinked partition under a store refuses with `refusing to write outside the scope` instead of
`path traversal rejected`; a store folder that leads out makes saves / uploads fail (500) instead of writing outside.

## Not in this PR

- The `saveAttachment` EXIF hook (`server/workspace/photo-locations/`) is its own group, next. It re-reads the
  saved photo by path (race only), and it writes the sidecar under `data/locations/` with `mkdir` + `writeFileAtomic`,
  so a `data/locations` linked out receives the sidecar — the symlinked-root class, in a different store.
- Hard links: not addressed, as in `plans/fix-3573-verified-open.md` — they cannot reach a host file across the
  Docker workspace mount.
- Workspace-rooted readers (`files.ts`, `pdf.ts`, `thumbnail-store`, `packHtml`), `mulmoscript-plugin` ops,
  `exportShapeScriptUsdz`, `runtime-plugin` assets — see `plans/fix-3573-artifact-mounts.md`.
