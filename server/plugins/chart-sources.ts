// The `sources` capability @mulmoclaude/chart-plugin asks its host for. A plugin
// does not import another plugin, so the spreadsheet package's engine calculates
// the range here, and the chart shows exactly what the sheet shows.

import { readCalculatedRange } from "@gui-chat-plugin/spreadsheet/core";
import type { ChartExecuteContext, ChartSource, ChartSourceReader } from "@mulmoclaude/chart-plugin";
import { makeArtifactsFileOps } from "./runtime.js";
import { workspaceRelativeWorkbook } from "./chart-source-path.js";
import { workspacePath } from "../workspace/paths.js";
import { CONTAINER_WORKSPACE_PATH } from "../agent/containerPaths.js";

export const toWorkspaceWorkbook = (spreadsheet: string): string =>
  workspaceRelativeWorkbook(spreadsheet, { host: workspacePath, sandbox: CONTAINER_WORKSPACE_PATH });

const chartSources: ChartSourceReader = {
  read: (source: ChartSource) => readCalculatedRange(makeArtifactsFileOps(), toWorkspaceWorkbook(source.spreadsheet), source.range),
};

/** What both the presentChart route and the View's readSource dispatch pass to the chart plugin. */
export function chartExecuteContext(): ChartExecuteContext {
  return { files: { artifacts: makeArtifactsFileOps() }, sources: chartSources };
}
