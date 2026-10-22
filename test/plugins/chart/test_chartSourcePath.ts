// The rule for the workbook path a chart's `source` names: relative, host
// absolute or sandbox absolute all become `artifacts/spreadsheets/…`, and
// nothing outside the workspace is turned into a workspace path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { renameChartSources, workspaceRelativeWorkbook } from "../../../server/plugins/chart-source-path.js";

const POSIX_ROOTS = { host: "/Users/me/mulmoclaude", sandbox: "/home/node/mulmoclaude" };
const WINDOWS_ROOTS = { host: "C:\\Users\\me\\mulmoclaude", sandbox: "/home/node/mulmoclaude" };
const WORKBOOK = "artifacts/spreadsheets/2026/10/0123456789abcdef.json";

const posix = (spreadsheet: string): string => workspaceRelativeWorkbook(spreadsheet, POSIX_ROOTS, path.posix);
const windows = (spreadsheet: string): string => workspaceRelativeWorkbook(spreadsheet, WINDOWS_ROOTS, path.win32);

describe("workspaceRelativeWorkbook", () => {
  it("keeps a relative path as it is", () => {
    assert.equal(posix(WORKBOOK), WORKBOOK);
    assert.equal(windows(WORKBOOK), WORKBOOK);
  });

  it("makes a host path inside the workspace relative", () => {
    assert.equal(posix(`/Users/me/mulmoclaude/${WORKBOOK}`), WORKBOOK);
    assert.equal(windows(`C:\\Users\\me\\mulmoclaude\\${WORKBOOK.split("/").join("\\")}`), WORKBOOK);
  });

  it("makes a sandbox path inside the workspace relative, on either host", () => {
    assert.equal(posix(`/home/node/mulmoclaude/${WORKBOOK}`), WORKBOOK);
    assert.equal(windows(`/home/node/mulmoclaude/${WORKBOOK}`), WORKBOOK);
  });

  it("leaves a path outside the workspace unchanged", () => {
    [
      "/etc/passwd",
      "/Users/me/mulmoclaude",
      "/Users/me/mulmoclaude-other/artifacts/spreadsheets/x.json",
      "/Users/me/mulmoclaude/../secret.json",
      "/home/node/mulmoclaude/../../etc/passwd",
      "/home/node/other/x.json",
    ].forEach((outside) => assert.equal(posix(outside), outside, outside));
    ["D:\\other\\x.json", "C:\\Users\\me\\mulmoclaude\\..\\x.json"].forEach((outside) => assert.equal(windows(outside), outside, outside));
  });

  it("does not resolve traversal inside a relative path", () => {
    assert.equal(posix("../artifacts/spreadsheets/x.json"), "../artifacts/spreadsheets/x.json");
    assert.equal(posix(""), "");
  });
});

describe("renameChartSources", () => {
  const upper = (spreadsheet: string): string => spreadsheet.toUpperCase();

  it("renames every source and sources entry", () => {
    const document = {
      charts: [
        { option: {}, source: { spreadsheet: "a", range: "A1:B2" } },
        {
          option: {},
          sources: [
            { spreadsheet: "b", range: "A1" },
            { spreadsheet: "c", range: "A1" },
          ],
        },
        { option: {} },
      ],
    };
    renameChartSources(document, upper);
    assert.deepEqual(document, {
      charts: [
        { option: {}, source: { spreadsheet: "A", range: "A1:B2" } },
        {
          option: {},
          sources: [
            { spreadsheet: "B", range: "A1" },
            { spreadsheet: "C", range: "A1" },
          ],
        },
        { option: {} },
      ],
    });
  });

  it("leaves what is not a chart document or a source alone", () => {
    [undefined, null, "x", 1, [], {}, { charts: "x" }].forEach((document) => assert.doesNotThrow(() => renameChartSources(document, upper)));
    const odd = { charts: [null, 1, { source: "x" }, { source: { spreadsheet: 1 } }, { sources: "x" }, { sources: [null, { range: "A1" }] }] };
    const before = JSON.stringify(odd);
    renameChartSources(odd, upper);
    assert.equal(JSON.stringify(odd), before);
  });
});
