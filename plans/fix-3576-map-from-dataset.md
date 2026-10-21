# fix(chart-plugin): a map drawn from a sheet range paints the regions with no data in the series colour (#3576)

## Problem

The `map of regions` recipe reads a sheet range (`source` + `encode: { itemName, value }`). ECharts
6.1.0 then paints every region with no row in the series' palette colour instead of the empty
colour, so on a visualMap scale the regions with no data read as the largest and the real values
look pale. The same values written into `series.data` are painted correctly. `itemStyle.areaColor`
does not change it; `itemStyle.color` does, but the right colour depends on the theme.

## Fix

- `withMapData` (`src/core/mapData.ts`): a top-level `type: "map"` series with no data of its own,
  reading a dataset that holds rows, gets those rows as `data: [{ name, value }]`, and loses
  `encode` / `datasetIndex`. The same shape as `withWordClouds`.
- The dataset reading (`datasetTable`, `columnOf`, the name/value pair) moves out of `wordCloud.ts`
  into `src/core/seriesDataset.ts`, used by both.
- Applied wherever the option is drawn: the View (and so its SVG export) and the server's trial draw.

## Tests

- `test_chartMapData.ts`: the rewrite's rules, and an ECharts SSR draw comparing region fills of a
  sourced map with the same values written inline.
- The recipe test draws through `withMapData`, and checks the map by value rather than by column,
  as it already did for word clouds.

- Left to ECharts, which reads them right: a row-wise dataset (`seriesLayoutBy: "row"`), and an
  option whose visualMap names a `dimension` (the `{ name, value }` items would not have that column).

## Out of scope

- A map inside a timeline (`baseOption` / `options`), which the rewrite does not reach.
- The 3D chart's axis labels on the dark theme: a separate change.
