import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import { View, Preview, type SpreadsheetToolData } from "@gui-chat-plugin/spreadsheet/vue";
// Vite lib mode does not inject the package's stylesheet; the consumer imports it.
import "@gui-chat-plugin/spreadsheet/style.css";
import { TOOL_DEFINITION, TOOL_NAME, type SpreadsheetEndpoints } from "./definition";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";

// wrapWithScope provides the runtime the package View needs: dispatch for
// loading and saving the workbook, and the host locale for its strings.
const spreadsheetPlugin: ToolPlugin<SpreadsheetToolData> = {
  toolDefinition: TOOL_DEFINITION,

  execute: makeRouteExecute<SpreadsheetEndpoints, SpreadsheetToolData>("spreadsheet", "create", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Creating spreadsheet...",
  viewComponent: wrapWithScope("spreadsheet", View),
  previewComponent: wrapWithScope("spreadsheet", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: spreadsheetPlugin,
};
