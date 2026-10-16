import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PluginRegistration } from "../../tools/types";
import { plugin as kenteiPlugin, type KenteiData, type KenteiJson } from "kenteiscript/plugin/vue";
// The View's scoped styles are a standalone stylesheet; Vite lib mode does not
// inject it, so the consumer imports it (same as presentShapeScript / presentForm).
import "kenteiscript/plugin/style.css";
import type { KenteiScriptEndpoints } from "./definition";
import { META } from "./meta";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";

// Scope name: the View's `useRuntime().dispatch({ kind: "grade", … })` posts to
// /api/plugins/runtime/kentei/dispatch, answered by the built-in dispatch handler
// registered in server/plugins/kentei-builtin.ts (JEV grading with the server's
// TYPESAFE_API_KEY — the key never reaches the browser).
const KENTEI_SCOPE = "kentei";

const TOOL_NAME = META.toolName;

// Imported from the browser entry, not ./definition, so the server bundle (Zod
// and the grading code) stays out of the client.
const pkg: ToolPlugin<KenteiData, KenteiJson, object> = kenteiPlugin;

// `unknown` JSON slot: the route executor returns the server body as-is, so it
// cannot vouch for `jsonData`'s shape (the View reads `data`, not `jsonData`).
const kenteiScriptPlugin: ToolPlugin<KenteiData, unknown, object> = {
  ...pkg,
  // Every action runs on the server (POST /api/kentei), which owns the key
  // check and the `files.byPath` capability for `path`.
  execute: makeRouteExecute<KenteiScriptEndpoints, KenteiData>(KENTEI_SCOPE, "dispatch", TOOL_NAME),
  ...(pkg.viewComponent ? { viewComponent: wrapWithScope(KENTEI_SCOPE, pkg.viewComponent) } : {}),
  ...(pkg.previewComponent ? { previewComponent: wrapWithScope(KENTEI_SCOPE, pkg.previewComponent) } : {}),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: kenteiScriptPlugin,
};
