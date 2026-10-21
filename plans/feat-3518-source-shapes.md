# feat: more shapes of a chart's source (#3518)

## Problem

`source` passed one range, read as a wide table (header row, category column), into the first
dataset. A cross table (correlation matrix), a long table to split into series by a column, and
two ranges kept apart (lower / upper bound) could not be drawn from the sheet.

## Approach

- `ChartSource` gains `layout?: "table" | "matrix"` and `groupBy?: { column, x?, value? }`;
  `ChartEntry` gains `sources?: ChartSource[]` (not alongside `source`). Hosts read a range as
  before (`spreadsheet`, `range`); the reshaping is the plugin's, so no host changes.
- `src/core/sourceShapes.ts` (pure): `matrixToCells` gives `[X, Y, Value]` rows, matching the
  heatmap recipe's header; `groupIntoColumns` pivots a long table, groups and x values in order of
  appearance, cells meeting added up (text: the last one). A missing column throws with the header.
- `chartOption(chart, rowsList, hasRuntime)` shapes each range and fills `dataset[i]`;
  `withSourceRows` is now `withSourceRowsList` with one range (checked identical over generated
  options). The server reads every range of a chart in order; a reshaping error is that chart's
  draw problem (#3519), on the server and on the card.
- The View reads all of a chart's ranges, shows them on the source line, and follows each workbook.
