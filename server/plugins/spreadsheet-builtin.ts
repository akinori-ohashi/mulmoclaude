// MulmoClaude's host wiring for the presentSpreadsheet View's dispatch channel.
// The @gui-chat-plugin/spreadsheet View loads and saves its workbook through
// `useRuntime().dispatch({ kind: "loadSpreadsheet" | "saveSpreadsheet", … })`;
// this routes those calls to the package's `executeSpreadsheetDispatch` against
// the workspace `artifacts/` (confined by realpath, so a symlink cannot lead out), then publishes a file-change event
// after a save that wrote the file. Imported for side effect at boot (server/index.ts).

import { executeSpreadsheetDispatch, isSpreadsheetDispatchArgs } from "@gui-chat-plugin/spreadsheet";
import { makeConfinedArtifactsFileOps } from "./confined-file-ops.js";
import { publishFileChange } from "../events/file-change.js";
import { describeKind, registerBuiltinDispatch } from "./builtin-dispatch.js";
import { wroteSpreadsheetFile } from "./spreadsheet-save-outcome.js";

/** Matches `wrapWithScope("spreadsheet", …)` in `src/plugins/spreadsheet/index.ts`. */
const SPREADSHEET_SCOPE = "spreadsheet";

registerBuiltinDispatch(SPREADSHEET_SCOPE, async (args) => {
  if (!isSpreadsheetDispatchArgs(args)) {
    throw new Error(`spreadsheet plugin: unrecognised dispatch payload (kind=${describeKind(args)})`);
  }
  const result = await executeSpreadsheetDispatch(makeConfinedArtifactsFileOps(), args);
  if (wroteSpreadsheetFile(args, result.data)) {
    void publishFileChange(args.path);
  }
  return result;
});
