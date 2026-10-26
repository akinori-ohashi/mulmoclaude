// MulmoClaude's host wiring for the presentChart View's dispatch channel. A
// chart drawn from a spreadsheet range reads its rows with
// `useRuntime().dispatch({ kind: "readSource", source })`; this routes that to
// the package's `readChartSource`. Imported for side effect at boot (server/index.ts).

import { isReadSourceArgs, readChartSource } from "@mulmoclaude/chart-plugin";
import { describeKind, registerBuiltinDispatch } from "./builtin-dispatch.js";
import { chartExecuteContext } from "./chart-sources.js";

/** Matches `wrapWithScope("chart", …)` in `src/plugins/chart/index.ts`. */
const CHART_SCOPE = "chart";

registerBuiltinDispatch(CHART_SCOPE, async (args) => {
  if (!isReadSourceArgs(args)) {
    throw new Error(`chart plugin: unrecognised dispatch payload (kind=${describeKind(args)})`);
  }
  return readChartSource(chartExecuteContext(), args);
});
