// MulmoClaude's wiring of @gui-chat-plugin/spreadsheet's View dispatch: the
// host routes `{ kind: "loadSpreadsheet" | "saveSpreadsheet" }` — and nothing
// else — to the package against the shared artifacts area. The package's own
// rules (path guard, sheet shape) are tested in its repo.

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isRecord } from "@mulmoclaude/common";
import "../../server/plugins/spreadsheet-builtin.js";
import { getBuiltinDispatch } from "../../server/plugins/builtin-dispatch.js";
import { workspacePath } from "../../server/workspace/paths.js";

const handler = getBuiltinDispatch("spreadsheet");
const testDir = `test-builtin-${process.pid}`;
const filePath = `artifacts/spreadsheets/${testDir}/sheet.json`;
const absolute = path.join(workspacePath, filePath);
const sheets = [{ name: "Budget", data: [[{ v: "Income" }, { v: 5000 }]] }];

/** The `version` a load or save answered, which names the file's content at that moment. */
const versionOf = (result: unknown): string =>
  isRecord(result) && isRecord(result.data) && typeof result.data.version === "string" ? result.data.version : "";

describe("spreadsheet built-in dispatch", () => {
  after(() => rmSync(path.join(workspacePath, "artifacts/spreadsheets", testDir), { recursive: true, force: true }));

  it("is registered under the scope the View dispatches to", () => {
    assert.equal(typeof handler, "function");
  });

  it("loads a saved workbook", async () => {
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, JSON.stringify(sheets));
    const result = await handler?.({ kind: "loadSpreadsheet", path: filePath });
    assert.deepEqual(result, { message: `Loaded spreadsheet ${filePath}`, data: { sheets, version: versionOf(result) } });
    assert.match(versionOf(result), /^[0-9a-f]{64}$/);
  });

  it("writes an edit back to the same file", async () => {
    const edited = [{ name: "Budget", data: [[{ v: "Income" }, { v: 6000 }]] }];
    const result = await handler?.({ kind: "saveSpreadsheet", path: filePath, sheets: edited });
    assert.deepEqual(result, { message: `Saved spreadsheet ${filePath}`, data: { sheets: filePath, version: versionOf(result) } });
    assert.deepEqual(JSON.parse(readFileSync(absolute, "utf8")), edited);
  });

  it("does not overwrite a change made since the View's version", async () => {
    const loaded = await handler?.({ kind: "loadSpreadsheet", path: filePath });
    const changedOnDisk = [{ name: "Budget", data: [[{ v: "Income" }, { v: 7000 }]] }];
    writeFileSync(absolute, JSON.stringify(changedOnDisk));
    const stale = [{ name: "Budget", data: [[{ v: "Income" }, { v: 1 }]] }];
    const result = await handler?.({ kind: "saveSpreadsheet", path: filePath, sheets: stale, baseVersion: versionOf(loaded) });
    assert.equal(isRecord(result) && isRecord(result.data) && result.data.conflict, true);
    assert.deepEqual(JSON.parse(readFileSync(absolute, "utf8")), changedOnDisk);
  });

  it("refuses anything that is not a load or save", async () => {
    await assert.rejects(handler?.({ kind: "deleteSpreadsheet", path: filePath }) ?? Promise.resolve(), /unrecognised dispatch payload/);
    await assert.rejects(handler?.({ kind: "saveSpreadsheet", path: filePath, sheets: [{ name: 1 }] }) ?? Promise.resolve(), /unrecognised dispatch payload/);
  });

  it("does not read or write through a symlink that leads out of the workspace", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "sheet-outside-"));
    try {
      writeFileSync(path.join(outside, "secret.json"), JSON.stringify(sheets));
      symlinkSync(path.join(outside, "secret.json"), path.join(path.dirname(absolute), "file-link.json"));
      symlinkSync(outside, path.join(path.dirname(absolute), "dir-link"));
      await assert.rejects(handler?.({ kind: "loadSpreadsheet", path: `artifacts/spreadsheets/${testDir}/file-link.json` }) ?? Promise.resolve());
      await assert.rejects(
        handler?.({ kind: "saveSpreadsheet", path: `artifacts/spreadsheets/${testDir}/dir-link/planted.json`, sheets }) ?? Promise.resolve(),
      );
      assert.deepEqual(readdirSync(outside), ["secret.json"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
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
