# feat: statistical transforms in the chart plugin (#3516)

## Problem

A fitted curve or a histogram drawn from a sheet's raw rows had to be computed outside the chart:
on the sheet (`COUNTIFS`, `TREND`), or by a script whose numbers were written into the option and
no longer followed the sheet. A non-linear fit had no sheet function at all.

## Approach

- Depend on `echarts-stat` and register its `ecStat:regression` and `ecStat:histogram` transforms
  with the ECharts the View draws with: `src/vue/charting.ts` registers them and hands the View its
  `echarts`, so the View cannot draw without them; the recipe tests draw through the same module.
  Its published types predate the transforms, so they are read off the module and checked.
- `echarts-stat` is external in the build and a dependency, like `echarts`, so the host bundles one copy.
- Recipes: a fitted curve straight from the raw columns, and a histogram straight from a column.
  The option's description says a transform sits in a second dataset after the source and a
  series reads it with `datasetIndex: 1`. `withSourceRows` already fills only the first dataset.

## Not clustering

`ecStat:clustering` runs a bisecting k-means seeded with `Math.random` and no restarts. Drawing
three well-separated pairs of points with three clusters split them wrongly in some draws out of
several hundred, and the cluster numbers change on every redraw. It is left unregistered; a
deterministic clustering transform would be its own change.

## Not a column-wise boxplot

ECharts' `boxplot` transform reads rows as groups; boxing a sheet's columns would need a transform
of our own. The sheet-computed boxplot recipe already covers it.

## Tests

`test/plugins/chart/test_chartRecipes.ts` registers the transforms through the same function and
draws each recipe. For the transforms it checks against answers that do not come from echarts-stat:
points lying exactly on `y = 50·e^(0.05x)` come back on that curve, sorted along x; a blank or text
row is skipped; every numeric value is counted once, in the bin whose edges contain it.
