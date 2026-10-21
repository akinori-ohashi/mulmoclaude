# fix(chart-plugin): 3D axis labels are unreadable on the dark theme (#3578)

## Problem

echarts-gl 2.1.0 draws grid3D's axis lines in #333, and the labels and axis names take that colour.
ECharts' dark theme says nothing about 3D axes, so on a dark card they sink into the background
while the #ccc split lines stand out.

## Fix

`withDarkAxes3D` (`src/core/darkAxes3D.ts`) lays light axis-line and pointer colours and faint
split lines under each grid3D; what the author wrote wins, key by key. The View applies it with the
rest of its dark-theme adjustments (`themed`), so the light theme is untouched.

## Verified

The same bar3D drawn in Chromium (WebGL) with ECharts 6.1.0 and echarts-gl 2.1.0 on the dark
theme, as it is now and through `withDarkAxes3D`: labels, categories and axis names read.

## Out of scope

`globe` and `geo3D`, which have no such axes; a 3D chart inside a timeline.
