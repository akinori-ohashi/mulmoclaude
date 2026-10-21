import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wroteSpreadsheetFile } from "../../server/plugins/spreadsheet-save-outcome.js";

const PATH = "artifacts/spreadsheets/2026/10/a.json";
const SHEETS = [{ name: "S", data: [[{ v: 1 }]] }];
const save = { kind: "saveSpreadsheet", path: PATH, sheets: SHEETS } as const;
const load = { kind: "loadSpreadsheet", path: PATH } as const;

describe("wroteSpreadsheetFile", () => {
  it("is true for a save that was written", () => {
    assert.equal(wroteSpreadsheetFile(save, { sheets: PATH, version: "v2" }), true);
    assert.equal(wroteSpreadsheetFile({ ...save, baseVersion: "v1" }, { sheets: PATH, version: "v2" }), true);
  });

  it("is false for a save refused for a conflict", () => {
    assert.equal(wroteSpreadsheetFile({ ...save, baseVersion: "v1" }, { sheets: SHEETS, version: "v3", conflict: true }), false);
  });

  it("is false for a load, whatever it answered", () => {
    assert.equal(wroteSpreadsheetFile(load, { sheets: SHEETS, version: "v1" }), false);
    assert.equal(wroteSpreadsheetFile(load, undefined), false);
  });

  it("is false for a save that answered no data", () => {
    assert.equal(wroteSpreadsheetFile(save, undefined), false);
  });
});
