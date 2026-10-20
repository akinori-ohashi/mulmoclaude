# feat: chart recipes in the presentChart tool description (#3523)

## Problem

The plugin loads the whole ECharts bundle, so most charts an analyst wants already render. The tool
description only names chart types, so an agent does not know how to write a boxplot, a Pareto
chart, a dual axis or a scatter drawn from a spreadsheet range, and it does not know that JSON
carries no formatter functions.

## Where the text goes

Claude Code cuts an MCP tool's top-level `description` at 2048 characters
(`CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`, appended "… [truncated]"); the input schema's property
descriptions are passed whole. So:

- the top-level description stays short (a test holds it under 2048) and points at `option`;
- the recipes go in the `option` property's description.

## Recipes are data, and each one is rendered in a test

`src/core/recipes.ts` holds the recipes as objects: what it is for, the header a source range
needs (when drawn from a sheet), and the ECharts option. The description is built from them, so
the text an agent reads is the option the test rendered.

`test/plugins/chart/test_chartRecipes.ts` renders every recipe with ECharts' server-side SVG
renderer (`ssr: true`):

- no exception, and no `[ECharts]` warning (an unknown series type or component warns);
- every series holds data;
- each sourced series is pinned to its type, the sheet columns it measures and its stack, read
  back from ECharts, since a series on the wrong column or out of its stack still draws;
- the dual-axis and Pareto lines sit on the second axis, and the waterfall's stack tops are the
  running totals;
- a sourced recipe is rendered through `withSourceRows` with sample rows under its header, as the
  View does;
- the boxplot and candlestick orders are checked by value, because a wrong column order still
  draws.

## Findings that shape the text

- ECharts' `boxplot` transform reads each ROW as one group, and a header row breaks it, so it
  cannot box a sheet's columns. The recipe computes the five numbers on the sheet
  (`MIN` / `QUARTILE` / `MEDIAN` / `MAX`) and draws them with `encode`.
- ECharts stacks negative values apart from positive ones, so a waterfall with a negative change
  floats away from its base. The recipe keeps every column non-negative: Base, Up, Down.
- Candlestick values are `[open, close, low, high]`, not OHLC.
- A straight fitted line drawn from a `TREND` column needs no sorting, since its points are
  collinear.

## Out of scope

Formatter functions (#3517), statistical transforms (#3516), reshaping `source` (#3518) and the
MulmoTerminal skill (receptron/mulmoterminal#3121).
