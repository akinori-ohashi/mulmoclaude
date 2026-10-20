// A chart's height and the number of cards side by side come from the agent, so they are kept
// within what the canvas can show, and anything that is not a number is refused.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chartHeightPx,
  documentColumns,
  gridColumnsClass,
  DEFAULT_CHART_HEIGHT_PX,
  MAX_CHART_HEIGHT_PX,
  MIN_CHART_HEIGHT_PX,
} from "../../../packages/plugins/chart-plugin/src/core/layout";
import { isValidChartDocument } from "../../../packages/plugins/chart-plugin/src/core/plugin";

describe("chartHeightPx", () => {
  it("uses the chart's height, rounded", () => {
    assert.equal(chartHeightPx({ height: 250 }), 250);
    assert.equal(chartHeightPx({ height: 250.6 }), 251);
  });

  it("keeps it between the limits", () => {
    assert.equal(chartHeightPx({ height: 10 }), MIN_CHART_HEIGHT_PX);
    assert.equal(chartHeightPx({ height: -5 }), MIN_CHART_HEIGHT_PX);
    assert.equal(chartHeightPx({ height: 99999 }), MAX_CHART_HEIGHT_PX);
  });

  it("falls back to the default without a finite height", () => {
    assert.equal(chartHeightPx({}), DEFAULT_CHART_HEIGHT_PX);
    [Number.NaN, Number.POSITIVE_INFINITY].forEach((height) => assert.equal(chartHeightPx({ height }), DEFAULT_CHART_HEIGHT_PX));
  });
});

describe("documentColumns and gridColumnsClass", () => {
  it("uses the document's columns, whole, from 1 to 4", () => {
    assert.equal(documentColumns({ columns: 2 }), 2);
    assert.equal(documentColumns({ columns: 3.7 }), 3);
    assert.equal(documentColumns({ columns: 0 }), 1);
    assert.equal(documentColumns({ columns: 9 }), 4);
  });

  it("is 1 without a document or a finite number", () => {
    assert.equal(documentColumns(undefined), 1);
    assert.equal(documentColumns({}), 1);
    assert.equal(documentColumns({ columns: Number.NaN }), 1);
  });

  it("names a whole Tailwind class for each count", () => {
    const classes = [1, 2, 3, 4].map(gridColumnsClass);
    assert.equal(classes[0], "grid-cols-1");
    classes.slice(1).forEach((name, index) => {
      const columns = index + 2;
      assert.equal(name, `grid-cols-[repeat(auto-fill,minmax(min(100%,max(20rem,calc((100%_-_${columns - 1}rem)/${columns}))),1fr))]`);
    });
    assert.equal(gridColumnsClass(0), "grid-cols-1");
    assert.equal(gridColumnsClass(7), classes[3]);
  });
});

describe("height and columns in the arguments", () => {
  const document = (extra: Record<string, unknown>, chartExtra: Record<string, unknown> = {}) => ({ charts: [{ option: {}, ...chartExtra }], ...extra });

  it("accepts numbers, out of range included (they are kept within the limits when drawn)", () => {
    assert.equal(isValidChartDocument(document({ columns: 2 }, { height: 250 })), true);
    assert.equal(isValidChartDocument(document({ columns: 10 }, { height: 5 })), true);
  });

  it("refuses what is not a finite number", () => {
    assert.equal(isValidChartDocument(document({ columns: "2" })), false);
    assert.equal(isValidChartDocument(document({}, { height: "tall" })), false);
    assert.equal(isValidChartDocument(document({}, { height: Number.NaN })), false);
  });
});
