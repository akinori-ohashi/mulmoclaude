// A chart can draw from a range of a saved spreadsheet instead of inline data.
// The host reads the range (calculating a workbook belongs to the spreadsheet
// plugin), so the chart plugin only checks the shapes, asks `context.sources`,
// and hands the View the rows to put in `dataset.source`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FileOps } from "gui-chat-protocol";
import {
  executeChart,
  isValidChartDocument,
  executeChartTool,
  readChartSource,
  type ChartExecuteContext,
  type ChartSourceReader,
} from "../../../packages/plugins/chart-plugin/src/core/plugin";
import { isChartSource, isReadSourceArgs, readSourceReply, sourceSpreadsheets, sourcesSignature, withSourceRows } from "../../../packages/plugins/chart-plugin/src/core/source";
import type { ChartSource, ChartSourceRows } from "../../../packages/plugins/chart-plugin/src/core/types";

const SOURCE: ChartSource = { spreadsheet: "artifacts/spreadsheets/2026/10/abc.json", range: "Summary!A1:B3" };
const ROWS: ChartSourceRows = [
  ["Month", "Sales"],
  ["Jan", 100],
  ["Feb", null],
];

function memoryArtifacts(): FileOps & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    read: async () => "",
    readBytes: async () => new Uint8Array(),
    write: async (rel) => {
      written.push(rel);
    },
    readDir: async () => [],
    stat: async () => ({ mtimeMs: 0, size: 0 }),
    exists: async () => false,
    unlink: async () => {},
  };
}

function readerReturning(rows: ChartSourceRows, seen: ChartSource[] = []): ChartSourceReader {
  return {
    read: async (source) => {
      seen.push(source);
      return rows;
    },
  };
}

const failingReader: ChartSourceReader = {
  read: async () => {
    throw new Error('the spreadsheet has no sheet named "Summary"');
  },
};

const sourcedDocument = { charts: [{ title: "Sales", source: SOURCE, option: { series: [{ type: "bar" }] } }] };

describe("isChartSource / isReadSourceArgs", () => {
  it("accepts a spreadsheet path and a range", () => {
    assert.equal(isChartSource(SOURCE), true);
    assert.equal(isReadSourceArgs({ kind: "readSource", source: SOURCE }), true);
  });

  it("rejects missing, empty or non-string fields", () => {
    [null, "x", [], {}, { spreadsheet: SOURCE.spreadsheet }, { range: "A1" }, { spreadsheet: " ", range: "A1" }, { spreadsheet: "a", range: 3 }].forEach(
      (value) => assert.equal(isChartSource(value), false, JSON.stringify(value)),
    );
  });

  it("rejects another kind, or a readSource without a valid source", () => {
    assert.equal(isReadSourceArgs({ kind: "other", source: SOURCE }), false);
    assert.equal(isReadSourceArgs({ kind: "readSource", source: { spreadsheet: "a" } }), false);
    assert.equal(isReadSourceArgs({ document: { charts: [] } }), false);
  });
});

describe("isValidChartDocument with a source", () => {
  it("accepts a chart with a valid source", () => {
    assert.equal(isValidChartDocument(sourcedDocument), true);
  });

  it("rejects a chart whose source is malformed", () => {
    assert.equal(isValidChartDocument({ charts: [{ source: { spreadsheet: "x" }, option: {} }] }), false);
  });
});

describe("readSourceReply", () => {
  it("returns the rows of a dispatch reply", () => {
    assert.deepEqual(readSourceReply({ message: "ok", data: { rows: ROWS } }), ROWS);
  });

  it("returns null for anything else", () => {
    [null, {}, { data: {} }, { data: { rows: "x" } }, { data: { rows: [1] } }, { data: { rows: [[{}]] } }, { data: { rows: [[Number.NaN]] } }].forEach((raw) =>
      assert.equal(readSourceReply(raw), null, JSON.stringify(raw)),
    );
  });
});

describe("withSourceRows / sourceSpreadsheets", () => {
  it("sets the rows as the dataset, replacing an inline one and keeping the rest", () => {
    const option = { dataset: { source: [["old"]] }, xAxis: { type: "category" } };
    assert.deepEqual(withSourceRows(option, ROWS), { dataset: { source: ROWS, sourceHeader: true }, xAxis: { type: "category" } });
    assert.deepEqual(option.dataset.source, [["old"]], "the stored option is not mutated");
  });

  it("lists each workbook once, skipping charts without a source", () => {
    const other = { spreadsheet: "artifacts/spreadsheets/2026/10/def.json", range: "A1:B2" };
    assert.deepEqual(sourceSpreadsheets([SOURCE, undefined, { ...SOURCE, range: "A1:A2" }, other]), [SOURCE.spreadsheet, other.spreadsheet]);
  });
});

describe("sourcesSignature", () => {
  it("changes when a source is added, removed or retargeted, and not otherwise", () => {
    const base = sourcesSignature([SOURCE, undefined]);
    assert.equal(sourcesSignature([{ ...SOURCE }, undefined]), base);
    assert.notEqual(sourcesSignature([SOURCE]), base);
    assert.notEqual(sourcesSignature([{ ...SOURCE, range: "Summary!A1:B4" }, undefined]), base);
    assert.notEqual(sourcesSignature([undefined, SOURCE]), base);
  });
});

describe("executeChart with a source", () => {
  it("reads each source once and saves the document with the reference, not the rows", async () => {
    const artifacts = memoryArtifacts();
    const seen: ChartSource[] = [];
    const result = await executeChart({ files: { artifacts }, sources: readerReturning(ROWS, seen) }, { document: sourcedDocument });
    assert.deepEqual(seen, [SOURCE]);
    assert.equal(artifacts.written.length, 1);
    assert.deepEqual(result.data?.document, sourcedDocument);
  });

  it("returns the reader's reason, and saves nothing, when a source cannot be read", async () => {
    const artifacts = memoryArtifacts();
    const result = await executeChart({ files: { artifacts }, sources: failingReader }, { document: sourcedDocument });
    assert.equal(result.data, undefined);
    assert.match(result.message ?? "", /Summary!A1:B3/);
    assert.match(result.message ?? "", /no sheet named "Summary"/);
    assert.equal(artifacts.written.length, 0);
  });

  it("tells the agent to pass data inline when the host cannot read sources", async () => {
    const artifacts = memoryArtifacts();
    const result = await executeChart({ files: { artifacts } }, { document: sourcedDocument });
    assert.equal(result.data, undefined);
    assert.match(result.message ?? "", /inline/);
    assert.equal(artifacts.written.length, 0);
  });

  it("does not need a reader for inline charts", async () => {
    const artifacts = memoryArtifacts();
    const result = await executeChart({ files: { artifacts } }, { document: { charts: [{ option: { series: [] } }] } });
    assert.ok(result.data);
    assert.equal(artifacts.written.length, 1);
  });
});

describe("the readSource dispatch", () => {
  it("returns the rows through readChartSource and through the tool entry point", async () => {
    const context: ChartExecuteContext = { files: { artifacts: memoryArtifacts() }, sources: readerReturning(ROWS) };
    assert.deepEqual((await readChartSource(context, { kind: "readSource", source: SOURCE })).data, { rows: ROWS });
    const viaExecute: unknown = await executeChartTool(context, { kind: "readSource", source: SOURCE });
    assert.deepEqual(readSourceReply(viaExecute), ROWS);
  });

  it("throws when the host cannot read sources, or the reader fails", async () => {
    await assert.rejects(readChartSource({ files: { artifacts: memoryArtifacts() } }, { kind: "readSource", source: SOURCE }), /cannot read/);
    await assert.rejects(
      readChartSource({ files: { artifacts: memoryArtifacts() }, sources: failingReader }, { kind: "readSource", source: SOURCE }),
      /no sheet/,
    );
  });
});
