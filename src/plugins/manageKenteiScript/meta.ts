import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageKenteiScript",
  apiNamespace: "kentei",
  apiRoutes: {
    /** POST /api/kentei — a manageKenteiScript action (getGuide / getSchema /
     *  checkScript / present). The View's `{ kind: "grade" }` calls go through
     *  the built-in dispatch channel instead (server/plugins/kentei-builtin.ts). */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
});
