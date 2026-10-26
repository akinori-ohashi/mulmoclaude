import { TOOL_DEFINITION as PACKAGE_TOOL_DEFINITION } from "@gui-chat-plugin/spreadsheet";
import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

// presentSpreadsheet's schema, validation, engine and View live in
// @gui-chat-plugin/spreadsheet (also consumed by MulmoTerminal). This built-in
// keeps MulmoClaude's routing META and the prompt, which points the agent at
// the workspace help file for cell formats and functions.
export const TOOL_NAME = META.toolName;

export type SpreadsheetEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export const TOOL_DEFINITION: ToolDefinition = {
  ...PACKAGE_TOOL_DEFINITION,
  prompt: `Use ${TOOL_NAME} when the user asks for a spreadsheet, table with calculations, or what-if analysis. Use formulas and cell references instead of pre-calculated values so the spreadsheet stays interactive. For cell format details and available functions, read \`config/helps/spreadsheet.md\` in the workspace.`,
};

export default TOOL_DEFINITION;
