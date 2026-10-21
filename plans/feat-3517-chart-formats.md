# feat: number and date formats without functions (#3517)

## Problem

The option is JSON, so formatters can only be ECharts template strings (`{value} %`). Thousands
separators, fixed digits, currency, percentages of a ratio and date formats could not be written.

## Approach

- `src/core/formats.ts` defines four format objects (`number`, `percent`, `currency`, `date`),
  each with an optional `template`. They are checked field by field; nothing is evaluated.
- `withFormatters(option, locale)` replaces a format with a function only at a fixed list of
  places, with the argument ECharts gives there (a bare value for axis labels and
  `valueFormatter`, params for labels). A label's number is picked out of a dataset row by the
  series' `encode`.
- Objects without `kind` are ECharts' own (a time axis's `{ year, month }`) and are left alone.
- `formatProblem(option)` names a malformed format, or a format at a place it is not replaced;
  `executeChart` refuses such a chart, with the place, before the trial draw.
- The View formats in the host's locale (`runtime.locale`); the server's trial uses the default.
- Numbers use `Intl.NumberFormat`; dates use `echarts.time.format`.
- Colour and size by value are left to `visualMap`, which needs no function; the description says so.
- A recipe in the description shows each kind.
