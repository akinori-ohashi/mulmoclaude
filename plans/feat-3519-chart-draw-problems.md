# feat: say why a chart could not be drawn (#3519)

## Problem

When `setOption` threw, the View swallowed it and the card stayed blank. Neither the user nor the
agent learned why, and the agent could not check what it had drawn.

## Approach

- `src/core/drawProblem.ts`: `setOptionProblem(chart, option)` sets the option and returns why it
  was not drawn, or null. `trialDrawProblem(option)` does the same on an off-screen SSR chart.
  - What ECharts throws is returned as it is.
  - A series of an unknown type is dropped without a throw (and logged only in a development
    build, once per type), so the series asked for are compared with `getOption().series`.
  - A production build reports missing axes as "Cannot read properties of undefined", so a
    cartesian series with no `xAxis` / `yAxis` is named before drawing.
  - A map that is not registered throws a TypeError that does not name it, so it is named first.
- `executeChart` draws each chart with the rows its source gives, and saves nothing if any fails;
  the reply names each chart and its reason.
- The View shows the reason on the card. A sourced chart is drawn empty until its rows arrive,
  which a transform cannot read, so no reason is shown until then.
- `charting.ts` / `statTransforms.ts` move from `src/vue` to `src/core`: the server draws with the
  same ECharts and transforms as the View.

## Not done

- A small picture of the drawn chart in the reply. The reason is what the agent needs to fix it;
  a picture is a separate, larger change.
