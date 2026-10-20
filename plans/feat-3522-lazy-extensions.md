# feat: maps and 3D, loaded when a chart needs them (#3522)

## Problem

Maps (which need `registerMap`) and 3D (echarts-gl) are not part of ECharts, so they
could not be drawn — maps above all, which regional analysis uses often.

## Approach

- `src/core/extensions.ts`: `neededExtensions(option)` (pure) finds echarts-gl series and
  components and bundled map names on map series, `geo` and `geo3D`, timeline
  parts included. `loadMaps` registers bundled maps once; `loadBrowserExtensions` also imports
  echarts-gl. All through dynamic `import()`, so nothing loads for a chart that
  does not use it.
- Maps: Natural Earth (public domain) world countries (1:110m) and Japan's prefectures (1:10m),
  slimmed to names and rounded coordinates (`src/maps/README.md` records source and steps). Each is
  registered with English names and, as `-ja`, Japanese names.
- Dependency: echarts-gl 2.1 (declares ECharts 6). External in the build together with
  `echarts/lib/*`, which it imports — otherwise the build carried a second ECharts that the extensions registered with.
- The View loads what its charts need before drawing them; a failed load is reported by the draw.
- The server loads maps before its trial draw (#3519). A 3D chart needs WebGL, so on the server only its formats are checked, and its card offers no SVG export.
- A map recipe, a description line, README.

## Left out

Word clouds: echarts-wordcloud 2.1 declares `echarts ^5` as its peer, and this plugin uses ECharts 6,
so how npm installs it for launcher users is unknown. Dropped from this change at the maintainer's
decision; a `wordCloud` series is refused by the trial draw as a series ECharts does not know.
