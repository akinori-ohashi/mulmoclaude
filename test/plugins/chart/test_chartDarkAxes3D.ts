import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withDarkAxes3D } from "../../../packages/plugins/chart-plugin/src/core/darkAxes3D";

const LIGHT_LINE = "#b9bdc6";

describe("withDarkAxes3D", () => {
  it("returns an option with no grid3D as it is", () => {
    const option = { xAxis: {}, yAxis: {}, series: [{ type: "bar" }] };
    assert.equal(withDarkAxes3D(option), option);
  });

  it("gives an empty grid3D light axis lines, a light pointer and faint split lines", () => {
    const { grid3D } = withDarkAxes3D({ grid3D: {}, series: [{ type: "bar3D" }] });
    assert.deepEqual(grid3D, {
      axisLine: { lineStyle: { color: LIGHT_LINE } },
      axisPointer: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
    });
  });

  it("keeps what the author wrote, down to a single colour, and adds only what is missing", () => {
    const authored = { boxWidth: 120, axisLine: { lineStyle: { color: "#f00", width: 3 } }, splitLine: { show: false } };
    const { grid3D } = withDarkAxes3D({ grid3D: authored });
    assert.deepEqual(grid3D, {
      boxWidth: 120,
      axisLine: { lineStyle: { color: "#f00", width: 3 } },
      axisPointer: { lineStyle: { color: "#e5e7eb" } },
      splitLine: { show: false, lineStyle: { color: "rgba(255,255,255,0.12)" } },
    });
    assert.deepEqual(authored, { boxWidth: 120, axisLine: { lineStyle: { color: "#f00", width: 3 } }, splitLine: { show: false } });
  });

  it("darkens each grid3D of a list", () => {
    const { grid3D } = withDarkAxes3D({ grid3D: [{}, { axisLine: { lineStyle: { color: "#0f0" } } }] });
    assert.ok(Array.isArray(grid3D));
    const field = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined);
    const colours = grid3D.map((grid: unknown) => field(field(field(grid, "axisLine"), "lineStyle"), "color"));
    assert.deepEqual(colours, [LIGHT_LINE, "#0f0"]);
  });
});
