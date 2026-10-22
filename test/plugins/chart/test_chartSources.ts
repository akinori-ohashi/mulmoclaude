// MulmoClaude's wiring of a chart drawn from a spreadsheet range: the
// presentChart route reads the range and saves the workbook's relative path,
// the View's readSource dispatch returns the current rows, and a change to the
// workbook reaches the chart's file channel.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import express from "express";
import { isRecord } from "@mulmoclaude/common";
import chartRouter from "../../../server/api/routes/chart.js";
import "../../../server/plugins/chart-builtin.js";
import { getBuiltinDispatch } from "../../../server/plugins/builtin-dispatch.js";
import { initFileChangePublisher, publishFileChange } from "../../../server/events/file-change.js";
import type { IPubSub } from "../../../server/events/pub-sub/index.js";
import { CONTAINER_WORKSPACE_PATH } from "../../../server/agent/containerPaths.js";
import { workspacePath } from "../../../server/workspace/paths.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

const testDir = `test-chart-sources-${process.pid}`;
const workbook = `artifacts/spreadsheets/${testDir}/sales.json`;
const sheets = [
  {
    name: "Sales",
    data: [
      [{ v: "Month" }, { v: "Units" }],
      [{ v: "Jan" }, { v: 10 }],
      [{ v: "Feb" }, { v: "=B2*2" }],
    ],
  },
];
const ROWS = [
  ["Month", "Units"],
  ["Jan", 10],
  ["Feb", 20],
];

const readSource = getBuiltinDispatch("chart");
const rowsOf = (result: unknown): unknown => (isRecord(result) && isRecord(result.data) ? result.data.rows : undefined);

let server: Server;
let baseUrl = "";

before(async () => {
  mkdirSync(path.join(workspacePath, path.dirname(workbook)), { recursive: true });
  writeFileSync(path.join(workspacePath, workbook), JSON.stringify(sheets));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(chartRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  assert.ok(isRecord(address) && typeof address.port === "number");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
  rmSync(path.join(workspacePath, "artifacts/spreadsheets", testDir), { recursive: true, force: true });
});

describe("the chart's readSource dispatch", () => {
  it("is registered under the scope the View dispatches to", () => {
    assert.equal(typeof readSource, "function");
  });

  it("returns the calculated rows, whichever way the workbook is named", async () => {
    const spellings = [workbook, path.join(workspacePath, workbook), `${CONTAINER_WORKSPACE_PATH}/${workbook}`];
    for (const spreadsheet of spellings) {
      const result = await readSource?.({ kind: "readSource", source: { spreadsheet, range: "Sales!A1:B3" } });
      assert.deepEqual(rowsOf(result), ROWS, spreadsheet);
    }
  });

  it("refuses a workbook outside the workspace's spreadsheets", async () => {
    await assert.rejects(readSource?.({ kind: "readSource", source: { spreadsheet: "/etc/passwd", range: "A1" } }) ?? Promise.resolve());
    await assert.rejects(readSource?.({ kind: "readSource", source: { spreadsheet: "artifacts/../secret.json", range: "A1" } }) ?? Promise.resolve());
  });

  it("refuses anything that is not a readSource", async () => {
    await assert.rejects(
      readSource?.({ kind: "deleteSource", source: { spreadsheet: workbook, range: "A1" } }) ?? Promise.resolve(),
      /unrecognised dispatch payload/,
    );
    await assert.rejects(readSource?.({ kind: "readSource", source: { spreadsheet: workbook } }) ?? Promise.resolve(), /unrecognised dispatch payload/);
  });
});

describe("POST presentChart with a source", () => {
  const post = async (spreadsheet: string): Promise<unknown> => {
    const option = { xAxis: { type: "category" }, yAxis: {}, series: [{ type: "bar" }] };
    const response = await fetch(`${baseUrl}${API_ROUTES.chart.create.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Units", document: { charts: [{ option, source: { spreadsheet, range: "Sales!A1:B3" } }] } }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  it("draws the chart and saves the workbook's relative path", async () => {
    const result = await post(`${CONTAINER_WORKSPACE_PATH}/${workbook}`);
    assert.ok(isRecord(result) && isRecord(result.data), JSON.stringify(result));
    const { document, filePath } = result.data;
    assert.ok(isRecord(document) && Array.isArray(document.charts));
    assert.deepEqual(isRecord(document.charts[0]) ? document.charts[0].source : undefined, { spreadsheet: workbook, range: "Sales!A1:B3" });
    assert.ok(typeof filePath === "string");
    const saved: unknown = JSON.parse(readFileSync(path.join(workspacePath, filePath), "utf8"));
    assert.ok(isRecord(saved) && Array.isArray(saved.charts) && isRecord(saved.charts[0]));
    assert.deepEqual(saved.charts[0].source, { spreadsheet: workbook, range: "Sales!A1:B3" });
    rmSync(path.join(workspacePath, filePath), { force: true });
  });

  it("says why when the range cannot be read", async () => {
    const result = await post("artifacts/spreadsheets/missing.json");
    assert.ok(isRecord(result));
    assert.equal(result.data, undefined);
    assert.equal(typeof result.message, "string");
  });
});

describe("a change to a workbook", () => {
  it("reaches the chart's file channel", async () => {
    const published: string[] = [];
    const pubsub: IPubSub = { publish: (channel: string) => void published.push(channel) };
    initFileChangePublisher(pubsub);
    await publishFileChange(workbook);
    assert.ok(published.includes(`plugin:chart:file:${workbook}`), published.join(", "));
    published.length = 0;
    await publishFileChange("artifacts/charts/x.json");
    assert.ok(!published.some((channel) => channel.startsWith("plugin:chart:")), published.join(", "));
  });
});
