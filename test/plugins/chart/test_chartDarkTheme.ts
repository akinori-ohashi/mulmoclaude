import { describe, it } from "node:test";
import assert from "node:assert/strict";
import darkTheme from "echarts/lib/theme/dark.js";
import { echarts } from "../../../packages/plugins/chart-plugin/src/core/charting";
import { DARK_GRID_3D, DARK_THEME, darkThemeWithAxes3D } from "../../../packages/plugins/chart-plugin/src/core/darkTheme";

/** A small bar chart drawn as SVG under `theme`, which an unregistered theme name draws in the light
 *  default. ECharts numbers its SVG classes and animations across every chart it draws (`zr0-cls-3`), so those numbers are evened out. */
function drawnWith(theme: string): string {
  const chart = echarts.init(null, theme, { renderer: "svg", ssr: true, width: 240, height: 160 });
  try {
    chart.setOption({ animation: false, xAxis: { type: "category", data: ["a", "b"] }, yAxis: {}, series: [{ type: "bar", data: [1, 2] }] });
    return chart.renderToSVGString().replace(/zr\d+-([a-z]+)-\d+/g, "zr-$1");
  } finally {
    chart.dispose();
  }
}

describe("the plugin's dark theme", () => {
  it("is ECharts' dark theme with grid3D axis colours added, which that theme has none of", () => {
    assert.equal(Reflect.get(darkTheme, "grid3D"), undefined);
    assert.deepEqual(darkThemeWithAxes3D(), { ...darkTheme, grid3D: DARK_GRID_3D });
  });

  it("is registered, and draws a 2D chart as ECharts' dark theme does", () => {
    assert.equal(drawnWith(DARK_THEME), drawnWith("dark"));
    assert.notEqual(drawnWith(DARK_THEME), drawnWith("not-a-registered-theme"));
  });
});
