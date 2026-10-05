# chore: reduce open code scanning alerts (#3360)

## Fix in code

- `js/identity-replacement`: drop the no-op `.replace` in `mulmoscript-plugin/test/test_plugin.ts`.
- jscpd same-file duplicates, each folded into one helper:
  - `mulmoscript-plugin/src/server/dispatch.ts` — `writeContextFor` (root guard → wire-path guard → context) for `save` / `updateBeat` / `updateScript`.
  - `mulmoscript-plugin/src/server/ops.ts` — `resolveRenderTarget` (root guard → ffmpeg guard → resolve) for movie / PDF.
  - `shapescript-plugin/src/shapescript/evaluator.ts` — `zipKeepingLeft` (`+` `-`) and `zipToShorter` (`*` `/`).
  - `shapescript-plugin/src/shapescript/toThreeJS.ts` — `mergeOwnedParts`.
  - `server/api/routes/mulmo-script.ts` — `parseFilePathQuery` for `movieStatus` / `pdfStatus`.

Behaviour preservation: the vector helpers were compared against the old loops on generated inputs
(`diff_vec.mjs`, results and thrown errors), and a test now pins the length rules. The guard
chains keep their order; `??` is exact because each guard returns `OpFailure | null`.

## Dismiss with reason (not code)

- Vendored SheetJS (`server/vendor/sheetjs/xlsx.mjs`): unmodified upstream copy; CodeQL default setup cannot path-ignore.
- `js/missing-rate-limiting` on the view-data query route: `viewActionRateLimit` is mounted (same as #442).
- `js/path-injection` in `triggerAutoBackgroundMovie`: absolute path taken as named (same as #469).
- jscpd cross-package / scaffold duplicates: same class as the earlier "won't fix" batch.
