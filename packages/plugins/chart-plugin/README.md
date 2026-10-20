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

### Shapes of a range, and several ranges

A source may ask for its rows reshaped before they become the dataset (`src/core/sourceShapes.ts`):

- `layout: "matrix"` — the range is a cross table (categories along the top row and down the first
  column, such as a correlation matrix). It is drawn as one `[X, Y, Value]` row per cell, which is
  what a heatmap reads.
- `groupBy: { column, x?, value? }` — the range is a long table (Date, Region, Sales). It is drawn
  with one column per value of `column` (Date, East, West), so each group becomes a series. Rows
  meeting in one cell are added up. A column that is not in the header is refused, naming it.

`sources: [...]` instead of `source` reads several ranges, the i-th into `dataset[i]` (a lower and
an upper bound kept on different sheets, say); transform datasets go after them.

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
recomputed whenever the sheet changes.

Two transforms are the plugin's own (`src/core/ownTransforms.ts`):

- `mulmo:clustering` — k-means over `config.dimensions` with `config.clusterCount`, adding a
  `Cluster` column. ecStat's clustering is not registered: its k-means starts from random centroids
  without retrying, so it split well-separated groups wrongly now and then and differently on each
  redraw. This one seeds k-means++ from a fixed seed, keeps the best of several starts, and numbers
  clusters in row order, so the same sheet gives the same groups every time.
- `mulmo:boxplotColumns` — one box per column (ECharts' `boxplot` transform takes each row as a
  group), with ECharts' quantiles and whiskers (`config.boundIQR`, 1.5 by default, or `"none"`).
  Its second result holds the outliers; ECharts drops that result's column names, so a series reads
  it in column order.

## Number and date formats

The option is JSON, so a `formatter` cannot be a function. Instead, a `formatter` or
`valueFormatter` may be a format object, which the plugin turns into a function before ECharts
sees it (`src/core/formats.ts`; nothing is evaluated):

- `{ "kind": "number", "digits"?, "grouping"?, "compact"?, "prefix"?, "suffix"? }`
- `{ "kind": "percent", "digits"? }` — a ratio, `0.12` → `12%`
- `{ "kind": "currency", "currency": "JPY", "digits"? }`
- `{ "kind": "date", "pattern": "{yyyy}-{MM}-{dd}" }` — ECharts' time template

Each takes `"template"`, e.g. `"{b}: {value}"` (`{a}` series name, `{b}` item name, `{d}` pie
percent). It works on an axis label or axis-pointer label, the tooltip's or a series'
`valueFormatter`, and a series' `label`, `endLabel` and `emphasis.label`. A format anywhere else,
or a malformed one, is refused with its place named. Numbers are written in the host's locale.
Colour or size by value needs no function: use `visualMap`.

## Maps and 3D

Loaded only when a chart uses them (`src/core/extensions.ts`), because they are large:

- **Maps** — `world` and `japan` (prefectures) ship with the plugin, from Natural Earth (public
  domain; see `src/maps/README.md`). `world-ja` / `japan-ja` are the same shapes named in
  Japanese (東京都, アメリカ合衆国), so a sheet's Japanese names find their regions. Use them as
  `series[].map` or `geo.map`.
- **3D** — echarts-gl (`scatter3D`, `bar3D`, `surface`, `line3D`, `grid3D`, `globe`, …).

echarts-gl is a dependency but external to the build, like `echarts`, so the host bundles one
ECharts it registers with. The server's trial draw loads the maps
first; a 3D chart needs WebGL, so on the server only its formats are
checked, and its card has no SVG export.

## Word clouds

`type: "wordCloud"` is laid out by the plugin (`src/core/wordCloudLayout.ts`) and drawn as an
ECharts `custom` series (`src/core/wordCloud.ts`), not with echarts-wordcloud, which declares
ECharts 5. Words come from `data` (`{ name, value }` or `[name, value]`) or from the series'
dataset (a sheet range: `encode.itemName` / `encode.value`, else its first two columns); the
largest 300 are kept. Settings: `sizeRange` (px, default `[12, 60]`), `rotationRange` (degrees
within ±90, default `[0, 90]`) with `rotationStep` (default 90), `gridSize` (px of the grid that
marks taken space, default 8), `textStyle.fontFamily` / `fontWeight`. Words are placed largest
first on a spiral from the centre; one that fits nowhere is left out. A word with CJK, kana or
hangul stays level whatever its angle. In the browser each word is measured in its font; the
server's trial draw, which has no fonts, estimates widths on the wide side. Each word takes the
next palette colour. A word cloud is an ordinary chart otherwise: drawn on the server's trial
draw, exported as SVG.

## Height and columns

A chart entry may set `height` in pixels (kept between 160 and 1200; 400 when left out), and the
document may set `columns` (1 to 4) to lay the cards out side by side — small multiples per
region or year, or a dashboard. Both are in `src/core/layout.ts`; the server's trial draw uses the
chart's height too.

## Dark appearance and exports

The View follows the host page's appearance: when `<html>` carries `data-appearance="dark"`
(MulmoTerminal's themes set it), cards are drawn dark and ECharts uses its `dark` theme on a
transparent background, and a switch redraws the charts. A host that never sets the attribute is
light; the OS's dark preference is not followed, so a light app does not get dark charts.

Each card exports PNG (on the card's colour), SVG (drawn again off screen with ECharts' SVG renderer
at the card's size), and CSV of the data it was drawn from — the first table dataset (a sheet's
rows included), or the category axis against each series' values — when that data has a table
shape (`src/core/exportData.ts`). Text a spreadsheet would run as a formula is written with a
leading quote.

## When a chart cannot be drawn

`presentChart` draws every chart once off screen (ECharts' server-side SVG renderer) with the
rows its source will give it, before saving anything. A chart ECharts cannot draw is not saved:
the agent gets each failing chart's number, title and reason, and is told to fix the option and
call again. Besides what ECharts throws, it names series types ECharts does not know (which it
drops silently), cartesian series with no `xAxis` or `yAxis`, and maps that are not registered.
The trial draws only the first 1000 rows of each series' `data` and dataset `source`, since
drawing is synchronous on the server; a problem that shows only in later rows is not caught
there, and the card reports it instead.

A document saved before this, or one that breaks in the browser only, shows the reason on the
chart's card instead of a blank canvas.

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
