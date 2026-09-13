import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "manageRoles";

export interface RolesEndpoints {
  [key: string]: string;
  list: string;
  manage: string;
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Create, update, or delete a custom user role stored in ~/mulmoclaude/roles/. After success, the frontend role list refreshes automatically.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete", "list"],
        description: "The action to perform. Use 'list' to display all custom roles in the canvas.",
      },
      role: {
        type: "object",
        description: "The full role definition (required for create/update)",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          icon: {
            type: "string",
            description:
              "A Material Icons ligature name (lowercase with underscores, e.g. 'smart_toy', 'science', 'draw', 'translate'). Default to 'smart_toy' if unsure.",
          },
          prompt: { type: "string" },
          availablePlugins: { type: "array", items: { type: "string" } },
          queries: { type: "array", items: { type: "string" } },
          model: {
            type: "string",
            // Deliberately does NOT list the aliases. This file is a static
            // object evaluated at import time, so it cannot read the host's
            // CHAT_MODELS — and #3130 existed to stop that list having a second
            // copy. A hardcoded list here would go stale silently and send the
            // agent a value the role schema then drops. `test_definition.ts`
            // holds this shape.
            description:
              "Optional model family for this role's sessions — one of the aliases offered in Settings \u2192 Model. Omit it to follow the app-wide choice. A value that is not a known alias is ignored. ALWAYS echo back the role's existing value when updating a role, or the setting is lost.",
          },
        },
        required: ["id", "name", "icon", "prompt", "availablePlugins"],
      },
      roleId: {
        type: "string",
        description: "The role ID to delete (required for delete action)",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
