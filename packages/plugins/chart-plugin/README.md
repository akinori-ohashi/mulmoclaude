# @mulmoclaude/chart-plugin

ECharts visualization plugin (presentChart) — shared gui-chat-protocol plugin for MulmoClaude and MulmoTerminal. Server-side write goes through the generic files.artifacts runtime capability.

A plugin for [MulmoClaude](https://github.com/receptron/mulmoclaude) and [MulmoTerminal](https://github.com/receptron/mulmoterminal) — loaded by the host, not run standalone.

## Drawing from a spreadsheet

A chart entry may carry `source: { spreadsheet, range }` instead of inline data — the path
`presentSpreadsheet` reported and a range such as `Summary!A1:C13`. The View draws `option` with
`dataset: { source: rows }`, where `rows` is the range calculated, and draws it again whenever the
host announces that the workbook changed (`file:<path>` on the plugin's runtime channel). So
editing the sheet moves the chart.

The host does the reading: it passes `sources: { read(source) }` in the execute context (a plugin
does not import the spreadsheet plugin), and routes the View's `dispatch({ kind: "readSource" })`
to the same `execute`. A host without `sources` still draws inline charts, and refuses a sourced
one with a message telling the agent to pass the data inline.

## Recipes for the agent

The `option` parameter's description carries recipes (`src/core/recipes.ts`): the ECharts option
for a boxplot, a Pareto chart, two value axes, a scatter drawn from a range, and so on. They sit
there rather than in the top-level description because Claude Code cuts that one at 2048
characters and passes parameter descriptions whole. Every recipe is drawn by ECharts in
`test/plugins/chart/test_chartRecipes.ts`, so an option that stops rendering fails the suite.

## Statistical transforms

The View registers two of [echarts-stat](https://github.com/ecomfe/echarts-stat)'s dataset
transforms, `ecStat:regression` (linear, exponential, logarithmic, polynomial) and
`ecStat:histogram`. Put one in a second dataset after the source and point a series at it with
`datasetIndex: 1`; with `source`, the rows fill the first dataset, so the fit and the bins are
recomputed whenever the sheet changes. `ecStat:clustering` is not registered: its k-means starts
from random centroids without retrying, so it splits well-separated groups wrongly now and then and
differently on each redraw.

## Dev loop

```bash
yarn workspace @mulmoclaude/chart-plugin run build
yarn workspace @mulmoclaude/chart-plugin run test
```

## Related projects

Used by both MulmoClaude and MulmoTerminal, and published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.
