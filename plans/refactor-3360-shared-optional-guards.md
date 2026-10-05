# refactor: share `isOptionalString` / `isOptionalBoolean` from `@mulmoclaude/common` (#3360, code scanning #509)

The same two predicates were hand-copied across tiers. jscpd flagged one pair (#509); the class is every copy.

## Scope

- Add `isOptionalString` / `isOptionalBoolean` (type guards) to `@mulmoclaude/common`, with tests.
- Replace the local copies in packages that already depend on common:
  `src/plugins/imageRouteResult.ts`, `src/plugins/wiki/parseWikiResponse.ts`, `src/utils/agent/parseSseEvent.ts`,
  `server/utils/files/session-io.ts`, `server/system/config.ts`, `@mulmoclaude/core` `notifier/store.ts`,
  `accounting-plugin` `server/journal.ts`.
- Regenerate `server/build/dispatcher.mjs` (core's chunk hash moves).

## Left out, deliberately

- `chart-plugin` (`core/plugin.ts`) and the LINE bridge (`parse.ts`) keep their copies: neither depends on
  `@mulmoclaude/common`, and adding a runtime dependency to a published plugin / bridge for a two-line predicate
  is not worth the coupling.

## Release consequence

New exports on `@mulmoclaude/common` trip the publish smoke's `drift` stage unless the version moves, so this
PR bumps common `1.3.0 → 1.4.0` (minor: additive) and sweeps every declared `@mulmoclaude/common` range to
`^1.4.0`. The launcher's own `version` is untouched. The bump is the acknowledgement; drift reports it as
pending publish. `@mulmoclaude/common@1.4.0` must be published (with its tag) before `core`,
`accounting-plugin` or the launcher is next published.
