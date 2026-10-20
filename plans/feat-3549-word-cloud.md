# feat: word clouds drawn with ECharts' own series (#3549)

## Problem

`type: "wordCloud"` is refused: echarts-wordcloud declares `echarts ^5` and was dropped from #3535.
Option C of #3549 was chosen: lay the words out ourselves and draw them with a standard series.

## Approach

- `src/core/wordCloud.ts`
  - Pure layout: `layoutWords(words, box)` places words largest first on a spiral from the centre,
    marking a grid of `gridSize` cells as taken; a word that does not fit anywhere is left out (as
    echarts-wordcloud does). Font size is linear in the value between `sizeRange`. Rotation is
    picked from `rotationRange` / `rotationStep` by a fixed-seed generator, so a redraw gives the
    same cloud. Text width is estimated (full-width characters 1em, others narrower) so the server
    and the browser lay out alike without measuring a font.
  - `withWordClouds(option)`: each top-level `wordCloud` series becomes a `custom` series whose
    `renderItem` lays the words out for the chart's current size (kept per size), with
    `colorBy: "data"` so each word takes the next palette colour (the dark theme's too).
  - Words come from `series.data` (`{ name, value }` or `[name, value]`) or from the series'
    dataset (a sheet range: `encode.itemName` / `encode.value`, else the first two columns).
- Applied where `withFormatters` is: the View's draw and the server's trial draw. A word cloud is
  then an ordinary SVG-drawable chart: trial draw on the server, SVG export on the card.
- Options: `sizeRange` (default [12, 60]), `rotationRange` (default [0, 90]), `rotationStep`
  (default 90), `gridSize` (default 8), `textStyle.fontFamily` / `fontWeight`. No `shape` /
  `maskImage` in this first version.
- Tool description and README say how to write one; a recipe reads Word / Count from a sheet.

## Tests

- Unit (`test/plugins/chart/test_chartWordCloud.ts`): sizes, rotations, determinism, no two
  placed rectangles overlap and all stay inside the box, words that cannot fit are dropped,
  data shapes and dataset/encode reading, malformed input, ECharts SSR draws the words.
- The #3535 test that refused a word cloud now saves one.
- e2e: a word cloud card draws without a problem; its exported SVG, laid out by the browser, has
  no two words overlapping (measured with `getBBox`, not with our own estimate).
