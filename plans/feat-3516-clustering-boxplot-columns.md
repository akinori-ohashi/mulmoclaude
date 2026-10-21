# feat: deterministic clustering and a boxplot per column (#3516, the rest)

## Problem

#3527 registered ecStat's regression and histogram and left two things open:

- `ecStat:clustering` seeds k-means from `Math.random` without restarts, so it split
  well-separated groups wrongly now and then and renumbered clusters on every redraw.
- ECharts' `boxplot` transform reads each row as a group; a sheet keeps one group per column.

## Approach

- `src/core/kMeans.ts` (pure): k-means++ seeded from a fixed-seed generator (mulberry32), the
  lowest-cost of several starts, clusters numbered in the order rows first meet them.
- `src/core/columnBoxes.ts` (pure): ECharts' quantile and whisker rule (`prepareBoxplotData`).
- `src/core/ownTransforms.ts` registers `mulmo:clustering` and `mulmo:boxplotColumns`, reading the
  upstream dataset; rows with a blank or text cell are skipped; without `config.dimensions`, every
  column holding a number is used (the label column is not). A wrong config throws with its name,
  which the trial draw (#3519) returns to the agent.
- Recipes for both in the option description.

## Tests

`test/plugins/chart/test_chartOwnTransforms.ts`: generated layouts of far-apart groups (equal and
very unequal sizes — one start misses the latter often), the same labels on every call, numbering,
edge counts; boxes compared with ECharts' own `prepareBoxplotData` over generated columns; both
transforms drawn through ECharts, including the clusters coloured apart through `visualMap`.
