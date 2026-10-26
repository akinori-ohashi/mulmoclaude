# feat: word clouds drawn by @modernized/echarts-wordcloud (#3560)

## Why

#3555 laid word clouds out in the plugin because echarts-wordcloud 2.1 declares `echarts ^5`.
`@modernized/echarts-wordcloud@4.0.0` declares `echarts ^6.1.0`, the host's line, so the
extension can draw them instead and the plugin's own layout goes.

## Decisions

- **Loaded like echarts-gl**: a dependency of the chart plugin, external to its build (it imports
  `echarts/lib/echarts`, already external), and `import()`ed in the browser only when a chart has a
  top-level `wordCloud` series (`neededExtensions(...).wordCloud`).
- **Words from a sheet range**: the extension reads only `series.data`, so `withWordClouds` still
  fills `data` from the series' dataset (`encode.itemName` / `encode.value`, else the first two
  columns, the largest 300) and drops `datasetIndex` / `encode`. The series stays `wordCloud`.
- **Settings** keep their names (`sizeRange`, `rotationRange`, `rotationStep`, `gridSize`), which
  the extension shares; out-of-range values still fall back to defaults. Anything else on the
  series (`shape`, `textStyle`, …) passes through to the extension.
- **Server checks formats only** (the user's choice): the extension lays words out on a DOM canvas,
  so `needsBrowser` is true for a word cloud and `presentChart`'s trial draw skips it, as for 3D.
  The timeline refusal stays: the data fill does not merge `baseOption` / `options`.
- **No SVG export** for a word cloud: the extension places words on timers after `setOption`, so an
  off-screen SVG taken at once would hold none of them.

## Given up

- The same cloud every draw (the extension places at random) and level CJK words.

## Tests

- `test_chartWordCloud.ts`: `cloudStyle`, `cloudWords`, the rewrite (type kept, data filled from
  the dataset, settings clamped, other keys kept), the timeline refusal, `executeChart` saves a word
  cloud without a trial draw.
- `test_chartExtensions.ts`: `neededExtensions` finds a word cloud; it needs a browser.
- `test_chartRecipes.ts`: the word cloud recipe is not drawn on the server; its rows become `data`.
- `e2e/tests/chart-word-cloud.spec.ts`: drawn in Chromium with no page error and no draw problem
  (an unloaded extension shows "Unknown series type"), and no SVG button.
