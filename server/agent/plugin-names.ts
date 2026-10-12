// Three derived views over `BUILT_IN_SERVER_BINDINGS` — the
// Vue-free plugin barrel that lists every built-in plugin's MCP
// binding (ToolDefinition + REST endpoint). The barrel lives at
// `src/plugins/server.ts` so plugin definitions stay co-located
// with the rest of the plugin source. This file is just the
// adapter layer for MCP-facing consumers
// (`mcp-server.ts`, `activeTools.ts`, `server/index.ts`).
//
// Adding / removing a plugin = edit `src/plugins/server.ts`. This
// file does not change.

import type { PromptFilesSource } from "@mulmoclaude/core/prompt-files";
import type { ToolDefinition } from "gui-chat-protocol";
import { BUILT_IN_SERVER_BINDINGS } from "../../src/plugins/server.js";

/** All ToolDefinition objects, derived from `BUILT_IN_SERVER_BINDINGS`. */
export const PLUGIN_DEFS: readonly ToolDefinition[] = BUILT_IN_SERVER_BINDINGS.map((binding) => binding.def);

/** Maps plugin tool name → the npm package its definition ships in, for the
 *  bindings that declare one. */
export const PLUGIN_PACKAGE_BY_TOOL: ReadonlyMap<string, string> = new Map(
  BUILT_IN_SERVER_BINDINGS.flatMap((binding) => (binding.packageName ? [[binding.def.name, binding.packageName] as const] : [])),
);

/** The built-in definitions whose prompt files the host writes at startup. */
export const BUILT_IN_PROMPT_FILE_SOURCES: readonly PromptFilesSource[] = BUILT_IN_SERVER_BINDINGS.flatMap((binding) =>
  binding.packageName ? [{ packageName: binding.packageName, definition: binding.def }] : [],
);

/** Maps plugin tool name → REST API endpoint. */
export const TOOL_ENDPOINTS: Readonly<Record<string, string>> = Object.fromEntries(
  BUILT_IN_SERVER_BINDINGS.map((binding) => [binding.def.name, binding.endpoint]),
);

/** Set of plugin names that have MCP tool definitions. */
export const MCP_PLUGIN_NAMES: ReadonlySet<string> = new Set(Object.keys(TOOL_ENDPOINTS));
