import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";
import { TOOL_DEFINITION } from "kenteiscript/plugin";

// manageKenteiScript's tool schema, KenteiScript validation, JEV grading, View
// and Preview live in the `kenteiscript` npm package (also used by MulmoTerminal
// and MulmoChat). This built-in is a thin host adapter, like presentShapeScript:
// it keeps MulmoClaude's routing META and scoped-runtime wrapping, and exists
// (rather than a runtime plugin) so the server can hand the package
// `files.byPath`, which is what makes the tool's `path` argument work.
//
// Server-only: this imports the package's server entry. The browser side
// (index.ts) takes the definition from `kenteiscript/plugin/vue`.
export const TOOL_NAME = META.toolName;

/** Resolved-URL view of the plugin's routes (dispatch). Auto-derived from META. */
export type KenteiScriptEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export { TOOL_DEFINITION };
export default TOOL_DEFINITION;
