# fix: photo location sidecars are read and written only inside the workspace (#3573)

Follow-up to `plans/fix-3573-store-files.md` (PR #3596). This PR moves the photo-locations group.

## Problem (reproduced on `main` at `9f9e0da8c`)

With `data/locations` replaced by a link to an outside folder, one `saveAttachment` of a photo wrote its sidecar
(`2026/10/<id>.json`) into the outside folder, and `listAllSidecars` (`GET` photo-locations) returned a record planted
there. The capture hook also re-read the photo by its absolute path after the verified write, so a partition swapped
for a link in between handed an outside file to the EXIF parser.

## Fix

- `SaveAttachmentHook` no longer receives the absolute path — only the workspace-relative path and MIME. The capture
  reads the bytes back with `loadAttachmentBytes` (the attachment store's verified read) and parses them
  (`parsePhotoExif(buf)`, replacing `readPhotoExif(absPath)`).
- `data/locations` is a store (`photo-locations/store.ts`, `makeStoreFiles`). The sidecar is written through
  `store.write`; its `0o600` mode is applied with `chmod` on the verified handle after the write.
- `StoreFiles.listDir` lists a folder only when it resolves inside the store (empty otherwise). `list.ts` walks with
  it and reads every sidecar through `store.read`, so a sidecar link out is skipped. Only names are check-then-use: Node has no handle-based `readdir`,
  so a folder swapped for a link between the check and the `readdir` can name outside entries (they surface only in a
  `log.warn` when their verified read is refused). Contents never leave the workspace. Same limit as
  `confined-file-ops`' `readDir`.

Behaviour changes: a `data/locations` leading outside makes the capture log `sidecar write failed` and the list
empty; a sidecar that is a link is skipped by the list. The sidecar is briefly at the default mode between the
rename and the `chmod` (the photo it describes carries the same GPS at the default mode).

## Not in this PR

- Hard links, as in `plans/fix-3573-verified-open.md`.
- Workspace-rooted readers (`files.ts`, `pdf.ts`, `thumbnail-store`, `packHtml`), `mulmoscript-plugin` ops,
  `exportShapeScriptUsdz`, `runtime-plugin` assets — see `plans/fix-3573-artifact-mounts.md`.
