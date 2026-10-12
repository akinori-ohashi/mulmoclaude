# feat: presentDocument uses the prompt split

Issue: #3369 (step 5, second plugin). Stacked on the presentMulmoScript PR (#3391),
which adds `PluginMeta.packageName`, `mcpBinding` and `toolPromptFor`.

## Change

- `@mulmoclaude/markdown-plugin` 5.2.0: the existing `prompt` becomes the constant
  `DOCUMENT_GUIDE`, used for `prompt` (unchanged) and
  `promptFiles["presentDocument.md"]`. `promptCompact` keeps when to use the tool,
  `markdown` vs `path` (never re-send an existing file), and the image-placeholder
  format; the Marp slide-deck details sit behind the Read.
- Host: `src/plugins/markdown/meta.ts` sets `packageName`.
- New host invariant test: every built-in binding whose definition declares a valid split
  must carry a `packageName` — otherwise the split is silently ignored.

## Verification

- Differential (throwaway script): `description`, `prompt`, `parameters` identical to
  the old definition; split valid.
- Plugin test: split valid, the file is `prompt`, the compact text keeps the image rule
  and points at the file.
- Host tests: every split-declaring built-in has its files on disk at the told path and
  its told path in the system prompt; removing `packageName` from the markdown META
  turns the invariant test red.
