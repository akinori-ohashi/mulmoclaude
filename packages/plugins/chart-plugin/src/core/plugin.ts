import type { FileOps, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { TOOL_NAME, TOOL_DEFINITION } from "./definition";
import { chartArtifactPath } from "./paths";
import { isChartSource, isReadSourceArgs } from "./source";
import type { ChartArgs, ChartDocument, ChartEntry, ChartSource, ChartSourceRows, PresentChartData, ReadSourceArgs, ReadSourceData } from "./types";

/** Reads a chart's source as calculated rows. The HOST supplies it, because
 *  calculating a workbook belongs to the spreadsheet plugin and a plugin does
 *  not import another plugin. Throws with a message the agent can act on. */
export interface ChartSourceReader {
  read(source: ChartSource): Promise<ChartSourceRows>;
}

/** Host capabilities `executeChart` needs, delivered through the GENERIC
 *  gui-chat-protocol runtime — `files.artifacts` (the shared,
 *  user-browsable output area), and `sources` when the host can read a
 *  chart's spreadsheet source. A host without `sources` still draws every
 *  chart whose data is inline. */
export interface ChartExecuteContext {
  files: { artifacts: FileOps };
  sources?: ChartSourceReader | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isValidChartEntry(value: unknown): value is ChartEntry {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.title)) return false;
  if (!isOptionalString(value.type)) return false;
  if (value.source !== undefined && !isChartSource(value.source)) return false;
  return isRecord(value.option);
}

export function isValidChartDocument(value: unknown): value is ChartDocument {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.title)) return false;
  if (!Array.isArray(value.charts)) return false;
  if (value.charts.length === 0) return false;
  return value.charts.every((entry) => isValidChartEntry(entry));
}

/**
 * Validate the chart document and persist it to the shared artifacts area
 * (`artifacts/charts/<YYYY>/<MM>/<slug>-<ts>.chart.json`) via the generic
 * `files.artifacts` runtime capability. Returns a ToolResult whose `data`
 * drives the View and preview sidebar.
 */
export const executeChart = async (context: ChartExecuteContext, args: ChartArgs): Promise<ToolResult<PresentChartData>> => {
  // Guard the payload shape first: a malformed/empty body (wrong content-type,
  // undefined, non-object) must surface as a normal tool-level error, not a
  // thrown TypeError → 500, since other hosts reuse this function directly.
  if (!isRecord(args)) {
    return {
      message: "presentChart args must be an object containing a `document`",
      instructions: "Acknowledge the error and retry with { document: { charts: [{ option: {...} }] } }.",
    };
  }
  const { document, title } = args;
  if (!isValidChartDocument(document)) {
    return {
      message: "document must be { charts: [{ option: {...}, title?, type?, source? }, ...] } with at least one entry, where source is { spreadsheet, range }",
      instructions: "Acknowledge that the chart could not be created and retry with a valid ECharts document shape.",
    };
  }
  if (title !== undefined && typeof title !== "string") {
    return {
      message: "title must be a string when provided",
      instructions: "Acknowledge the error and retry with a string title (or omit it).",
    };
  }

  const sourceProblem = await checkSources(context, document);
  if (sourceProblem) {
    return {
      message: sourceProblem,
      instructions: "Acknowledge that the chart could not be created. Fix the spreadsheet path or range, or pass the data inline in option instead of source.",
    };
  }

  const baseLabel = title ?? document.title ?? "chart";
  const { relPath, filePath } = chartArtifactPath(baseLabel);
  await context.files.artifacts.write(relPath, `${JSON.stringify(document, null, 2)}\n`);

  const chartCount = document.charts.length;
  return {
    message: `Saved chart document to ${filePath}`,
    data: { document, title, filePath },
    instructions: `Acknowledge that the chart(s) have been presented to the user. The document contains ${chartCount} chart${chartCount === 1 ? "" : "s"}.`,
  };
};

/** Read every source once, so a wrong path or range reaches the agent now
 *  rather than as a blank chart later. Null when all of them read. */
async function checkSources(context: ChartExecuteContext, document: ChartDocument): Promise<string | null> {
  const sources = document.charts.flatMap((chart) => (chart.source ? [chart.source] : []));
  if (sources.length === 0) return null;
  if (!context.sources) return "This host cannot read a spreadsheet source; pass the chart's data inline in option.";
  for (const source of sources) {
    try {
      await context.sources.read(source);
    } catch (error) {
      return `Cannot read ${source.range} of ${source.spreadsheet}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}

/** The View's `dispatch({ kind: "readSource", source })`: the source's current rows. */
export const readChartSource = async (context: ChartExecuteContext, args: ReadSourceArgs): Promise<ToolResult<ReadSourceData>> => {
  if (!context.sources) throw new Error("This host cannot read a spreadsheet source");
  const rows = await context.sources.read(args.source);
  return { message: `Read ${args.source.range} of ${args.source.spreadsheet}`, data: { rows } };
};

/** One entry point for the tool call and the View's dispatch, told apart by `kind`. */
export const executeChartTool = async (
  context: ChartExecuteContext,
  args: ChartArgs | ReadSourceArgs,
): Promise<ToolResult<PresentChartData | ReadSourceData>> => (isReadSourceArgs(args) ? readChartSource(context, args) : executeChart(context, args));

export const pluginCore: ToolPluginCore<PresentChartData, PresentChartData, ChartArgs> = {
  toolDefinition: TOOL_DEFINITION,
  // `execute` reads host backends off `context.files.artifacts` and
  // `context.sources` rather than gui-chat-protocol's `ToolContext`; bridge the
  // nominal gap (the host injects the matching shape) the same way
  // @mulmoclaude/markdown-plugin does.
  execute: executeChartTool as unknown as ToolPluginCore<PresentChartData, PresentChartData, ChartArgs>["execute"],
  generatingMessage: "Rendering chart…",
  isEnabled: () => true,
};

export { TOOL_NAME, TOOL_DEFINITION };
