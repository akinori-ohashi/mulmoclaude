# feat: charts drawn from a spreadsheet range in MulmoClaude (#3512)

## Why

chart-plugin lets a chart entry name a saved spreadsheet range (`source` / `sources`) instead of
carrying its numbers, and asks the host to read it through `context.sources.read(source)`.
MulmoTerminal supplies it (receptron/mulmoterminal#3099). MulmoClaude's `POST /api/chart` did not,
so such a chart was refused with "put the data in the option". #3498 made the spreadsheet the
`@gui-chat-plugin/spreadsheet` package, whose `readCalculatedRange` calculates a range.

## Decisions

- **One context for both entry points.** `server/plugins/chart-sources.ts` builds
  `{ files: { artifacts }, sources }`. The create route passes it to `executeChart`, and the View's
  `dispatch({ kind: "readSource" })` reaches `readChartSource` with the same context through the
  built-in dispatch registry (`server/plugins/chart-builtin.ts`, scope `chart`, the scope
  `wrapWithScope("chart", View)` already uses).
- **Any spelling of the workbook path.** The spreadsheet tool reports `artifacts/spreadsheets/…json`.
  The agent may still name it by its host path, or by its sandbox path (`/home/node/mulmoclaude/…`).
  `workspaceRelativeWorkbook` (pure, `server/plugins/chart-source-path.ts`) turns either absolute
  form inside the workspace into the relative one; anything else is passed on unchanged, for the
  spreadsheet package to refuse.
- **The saved chart names the relative path.** The create route rewrites each entry's
  `source.spreadsheet` / `sources[].spreadsheet` to the relative form before `executeChart` saves
  it. The View subscribes to `file:<path as saved>`, and the publisher forwards changes under the
  workspace-relative path, so only the relative spelling would ever be redrawn.
- **Changes reach the chart.** The file-change publisher forwards a workbook's change to
  `plugin:chart:file:<path>` (scope `chart`, matched by the package's `isSpreadsheetArtifactPath`),
  as it already does for markdown and html. A save from the spreadsheet View publishes one
  (`spreadsheet-builtin.ts`).

## Not in scope

- Forwarding to `plugin:spreadsheet:file:` (MulmoTerminal does; a spreadsheet View following its
  own file is a separate change).
- Sharing `workspaceRelativeWorkbook` with MulmoTerminal: the sandbox path is MulmoClaude's.

## Checks

- Unit: the path rule both ways (relative, host-absolute, sandbox-absolute, outside, traversal,
  Windows host path); the rewrite of `source` / `sources`; the dispatch reads a real workbook and
  refuses anything but `readSource`; the create route draws a chart from a range.
- Real app: a chart from a range draws, and redraws after the sheet is edited in its View.
