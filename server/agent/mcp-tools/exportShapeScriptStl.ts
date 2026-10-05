// `exportShapeScriptStl` — write a ShapeScript model out as a binary STL for a
// slicer: one watertight solid (through manifold), in millimetres, Z up,
// resting on Z = 0, with a printability report.
//
// A pure MCP tool like `exportShapeScriptUsdz`: no View, the answer is a file
// path and the report. Everything about the tool — schema, description, the
// export and its report, where under `artifacts/shapes/` the file lands — lives
// in `@gui-chat-plugin/shapescript`; this host contributes the same `{ artifacts,
// byPath }` pair the USDZ export reads through, so the two accept exactly the
// same paths.

import {
  executeExportShapeScriptStl,
  EXPORT_STL_DESCRIPTION,
  EXPORT_STL_PROMPT,
  EXPORT_STL_SCHEMA,
  EXPORT_STL_TOOL_NAME,
  EXPORT_STL_TOOL_TIMEOUT_MS,
} from "@gui-chat-plugin/shapescript";
import { log } from "../../system/logger/index.js";
import { shapeFiles } from "./exportShapeScriptUsdz.js";
import type { McpTool } from "./index.js";

export const exportShapeScriptStl: McpTool = {
  definition: {
    name: EXPORT_STL_TOOL_NAME,
    description: EXPORT_STL_DESCRIPTION,
    inputSchema: EXPORT_STL_SCHEMA,
  },
  // Merging a large lattice spends most of the conversion budget before the STL
  // is written; the bridge's default would abort an export about to succeed.
  bridgeTimeoutMs: EXPORT_STL_TOOL_TIMEOUT_MS,
  prompt: EXPORT_STL_PROMPT,
  handler: async (args: Record<string, unknown>): Promise<string> => {
    log.info("render", "exportShapeScriptStl: start", { args: Object.keys(args).join(",") });
    const { message, filePath, bytes } = await executeExportShapeScriptStl({ files: shapeFiles }, args);
    log.info("render", "exportShapeScriptStl: ok", { filePath, bytes });
    return message;
  },
};
