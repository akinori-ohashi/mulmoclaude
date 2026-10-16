// MulmoClaude's host wiring for the manageKenteiScript plugin (`kenteiscript`
// npm package). Two entry points reach the package's executor:
//
//   - the tool's actions (getGuide / getSchema / checkScript / present), posted
//     by the MCP bridge to API_ROUTES.kentei.dispatch (server/api/routes/plugins.ts);
//   - the View's `useRuntime().dispatch({ kind: "grade", … })`, registered here
//     as the built-in "kentei" dispatch handler so it resolves on
//     /api/plugins/runtime/kentei/dispatch.
//
// Both hand the package the same context. Its only capability is
// `files.byPath` (`.json` only), which is what makes the tool's `path`
// argument work — a runtime-plugin install gets an empty context
// (server/api/routes/runtime-plugin.ts), so `path` would be refused there.
// Grading reads TYPESAFE_API_KEY (and optional JEV_MODEL / JEV_URL) from this
// process's environment inside the package; the key never reaches the browser.
// Imported for side effect at boot (server/index.ts).

import { isGradeRequest, manageKenteiScript, type KenteiContext } from "kenteiscript/plugin";
import { describeKind, registerBuiltinDispatch } from "./builtin-dispatch.js";
import { makeByPathFileOps } from "../utils/files/by-path.js";

/** Scope name — matches `wrapWithScope("kentei", …)` in
 *  `src/plugins/manageKenteiScript/index.ts`, which is what the View's
 *  `useRuntime().dispatch` uses as the `:pkg` path segment. */
const KENTEI_SCOPE = "kentei";

/** A KenteiScript is a JSON file, so `path` may name only `.json`. */
export const KENTEI_SCRIPT_EXTENSIONS: readonly string[] = [".json"];

// Built once: by-path file ops hold no state.
const kenteiFiles = { byPath: makeByPathFileOps(KENTEI_SCRIPT_EXTENSIONS) };

/** Run the package's executor with MulmoClaude's capabilities added to
 *  whatever per-request context the caller has (e.g. `currentResult`). */
export function executeKenteiScript(context: KenteiContext, args: unknown): Promise<unknown> {
  return manageKenteiScript({ ...context, files: kenteiFiles }, args);
}

// `args` is whatever the View put on the wire. The View dispatches only
// `{ kind: "grade" }`; tool actions arrive on the MCP route, so anything else
// here is refused rather than run.
registerBuiltinDispatch(KENTEI_SCOPE, async (args) => {
  if (!isGradeRequest(args)) {
    throw new Error(`kentei plugin: unrecognised dispatch payload (kind=${describeKind(args)})`);
  }
  return executeKenteiScript({}, args);
});
