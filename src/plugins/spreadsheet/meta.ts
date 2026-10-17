import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentSpreadsheet",
  apiNamespace: "spreadsheet",
  apiRoutes: {
    /** POST /api/spreadsheet — create a new spreadsheet. Cell edits are
     *  saved through the View's dispatch (server/plugins/spreadsheet-builtin.ts). */
    create: { method: "POST", path: "" },
  },
  mcpDispatch: "create",
});
