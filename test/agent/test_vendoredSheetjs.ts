// The server reads `.xlsx` attachments through a vendored copy of SheetJS CE
// (server/vendor/sheetjs/), because npm 12 refuses the CDN-URL dependency the
// launcher used to declare (#3316).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "../../server/vendor/sheetjs/xlsx.mjs";
import { convertAttachment } from "../../server/agent/attachmentConverter.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const sha256Of = (relativePath: string): string =>
  createHash("sha256")
    .update(readFileSync(path.join(REPO_ROOT, relativePath)))
    .digest("hex");

const workbookBase64 = (sheets: Record<string, unknown[][]>): string => {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name));
  const bytes: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return bytes.toString("base64");
};

describe("vendored SheetJS", () => {
  it("is the same xlsx.mjs the root xlsx dependency installs", () => {
    // A root `xlsx` bump without re-copying the vendored file fails here.
    assert.equal(sha256Of("server/vendor/sheetjs/xlsx.mjs"), sha256Of("node_modules/xlsx/xlsx.mjs"));
  });

  it("converts a single-sheet .xlsx attachment to CSV", async () => {
    const data = workbookBase64({
      Sheet1: [
        ["name", "qty"],
        ["apple", 3],
      ],
    });
    const result = await convertAttachment({ mimeType: XLSX_MIME, data, filename: "stock.xlsx" });
    assert.deepEqual(result, { kind: "converted", blocks: [{ type: "text", text: "[File: stock.xlsx]\n\nname,qty\napple,3" }] });
  });

  it("labels each sheet when the workbook has several", async () => {
    const data = workbookBase64({ First: [["a"]], Second: [["b"]] });
    const result = await convertAttachment({ mimeType: XLSX_MIME, data });
    assert.deepEqual(result, { kind: "converted", blocks: [{ type: "text", text: "## Sheet: First\n\na\n\n## Sheet: Second\n\nb" }] });
  });
});
