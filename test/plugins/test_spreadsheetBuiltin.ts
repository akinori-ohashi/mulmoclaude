// MulmoClaude's wiring of @gui-chat-plugin/spreadsheet's View dispatch: the
// host routes `{ kind: "loadSpreadsheet" | "saveSpreadsheet" }` — and nothing
// else — to the package against the shared artifacts area. The package's own
// rules (path guard, sheet shape) are tested in its repo.

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import "../../server/plugins/spreadsheet-builtin.js";
import { getBuiltinDispatch } from "../../server/plugins/builtin-dispatch.js";
import { workspacePath } from "../../server/workspace/paths.js";

const handler = getBuiltinDispatch("spreadsheet");
const testDir = `test-builtin-${process.pid}`;
const filePath = `artifacts/spreadsheets/${testDir}/sheet.json`;
const absolute = path.join(workspacePath, filePath);
const sheets = [{ name: "Budget", data: [[{ v: "Income" }, { v: 5000 }]] }];

describe("spreadsheet built-in dispatch", () => {
  after(() => rmSync(path.join(workspacePath, "artifacts/spreadsheets", testDir), { recursive: true, force: true }));

  it("is registered under the scope the View dispatches to", () => {
    assert.equal(typeof handler, "function");
  });

  it("loads a saved workbook", async () => {
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, JSON.stringify(sheets));
    const result = await handler?.({ kind: "loadSpreadsheet", path: filePath });
    assert.deepEqual(result, { message: `Loaded spreadsheet ${filePath}`, data: { sheets } });
  });

  it("writes an edit back to the same file", async () => {
    const edited = [{ name: "Budget", data: [[{ v: "Income" }, { v: 6000 }]] }];
    const result = await handler?.({ kind: "saveSpreadsheet", path: filePath, sheets: edited });
    assert.deepEqual(result, { message: `Saved spreadsheet ${filePath}`, data: { sheets: filePath } });
    assert.deepEqual(JSON.parse(readFileSync(absolute, "utf8")), edited);
  });

  it("refuses anything that is not a load or save", async () => {
    await assert.rejects(handler?.({ kind: "deleteSpreadsheet", path: filePath }) ?? Promise.resolve(), /unrecognised dispatch payload/);
    await assert.rejects(handler?.({ kind: "saveSpreadsheet", path: filePath, sheets: [{ name: 1 }] }) ?? Promise.resolve(), /unrecognised dispatch payload/);
  });

  it("refuses a path outside artifacts/spreadsheets/ without writing", async () => {
    const outside = "artifacts/html/escape.json";
    await assert.rejects(handler?.({ kind: "saveSpreadsheet", path: outside, sheets }) ?? Promise.resolve(), /artifacts\/spreadsheets/);
    await assert.rejects(
      handler?.({ kind: "saveSpreadsheet", path: `artifacts/spreadsheets/../html/escape.json`, sheets }) ?? Promise.resolve(),
      /artifacts\/spreadsheets/,
    );
    assert.throws(() => readFileSync(path.join(workspacePath, outside)), /ENOENT/);
  });
});
