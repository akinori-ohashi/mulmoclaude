# feat: chart height and cards in columns (#3520)

## Problem

Every chart was 400px tall and the cards stacked in one column, so small multiples, a scatter
matrix, or several grids in one option were cramped.

## Approach

- `ChartEntry.height` (px) and `ChartDocument.columns` (cards side by side), both optional.
- `src/core/layout.ts` (pure): `chartHeightPx` keeps the height between 160 and 1200 (400 by
  default); `documentColumns` keeps columns between 1 and 4; `gridColumnsClass` names whole
  Tailwind classes so they survive class scanning.
- Arguments that are not finite numbers are refused; out-of-range numbers are kept within the
  limits rather than refused, since the intent is clear.
- The View lays the cards out with `grid` and sets each canvas's height through a CSS variable
  (`h-[var(--chart-height)]`); the existing ResizeObserver redraws a chart when its card changes size.
- The server's trial draw (#3519) uses the chart's height.
