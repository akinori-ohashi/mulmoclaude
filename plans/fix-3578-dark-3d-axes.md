# fix(chart-plugin): 3D axis labels are unreadable on the dark theme (#3578)

## Problem

echarts-gl 2.1.0 draws grid3D's axis lines in #333, and the labels and axis names take that colour.
ECharts' dark theme says nothing about grid3D, so on a dark card they sink into the background
while the #ccc split lines stand out.

## Fix

A theme of our own, `mulmo-dark` (`src/core/darkTheme.ts`): ECharts' dark theme plus `grid3D`
axis-line, pointer and split-line colours, registered in `charting.ts` and used wherever the View
draws dark (`echartsTheme`).

A theme rather than a rewrite of the option, because ECharts merges a component's theme values
under what the author wrote (`ComponentModel.mergeDefaultAndTheme`). Author precedence, several
grids, and a timeline's `baseOption` / `options` are then ECharts' own business. An option rewrite
was tried first and needed a new rule each review round (timeline parts, non-object grids, base
colours overridden by option parts).

## Verified

In Chromium (WebGL) with ECharts 6.1.0 and echarts-gl 2.1.0: the same bar3D under `dark` and under
the new theme (labels read), with an author axis colour (it wins), and in a timeline whose
baseOption sets the axis colour while an option sets only split lines (the base colour survives).

## Out of scope

`globe` and `geo3D`, which have no such axes.
