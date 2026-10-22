# fix(chart-plugin): word clouds are one colour since 4.6.0 (#3588)

## Problem

Since word clouds are drawn by `@modernized/echarts-wordcloud` (4.6.0), every word is one colour —
light grey on the dark theme. The extension takes a word's fill from its `textStyle.color` visual, which
is one value for the series unless each word carries its own; `colorBy: "data"` does not change it.
Before 4.6.0 each word took the palette's next colour.

## Fix

`withWordClouds` gives each word `textStyle.color` from the palette, in order, as `colorBy: "data"` did:
the option's own `color` list when it has one, else ECharts' default palette
(`echarts/lib/model/globalDefault.js`, shared by the light and the dark theme). A colour the author
gave a word is kept, and a series whose `textStyle.color` the author set is left to that colour.

## Verified

The rewritten option drawn in Chromium with ECharts 6.1.0 and the extension 4.0.1, on the dark and
the light theme: each word in its own palette colour, in the order the old word cloud used.
