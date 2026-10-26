// Whether a spreadsheet dispatch changed the file on disk, so the host should announce it.
// A save refused for a conflict (the file moved on since the View's baseVersion) wrote nothing.

import type { SpreadsheetDispatchArgs, SpreadsheetFileData } from "@gui-chat-plugin/spreadsheet";

export const wroteSpreadsheetFile = (args: SpreadsheetDispatchArgs, data: SpreadsheetFileData | undefined): boolean =>
  args.kind === "saveSpreadsheet" && data !== undefined && data.conflict !== true;
