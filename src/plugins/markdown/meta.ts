import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentDocument",
  packageName: "@mulmoclaude/markdown-plugin",
  apiNamespace: "markdown",
  apiRoutes: {
    /** POST /api/markdown — create a new markdown document. */
    create: { method: "POST", path: "" },
    /** PUT /api/markdown/update — overwrite an existing document.
     *  Body carries the workspace-relative path so the route doesn't
     *  have to reconstruct one from a basename — required after #764
     *  sharded artifact storage by YYYY/MM. */
    update: { method: "PUT", path: "/update" },
  },
  mcpDispatch: "create",
});
