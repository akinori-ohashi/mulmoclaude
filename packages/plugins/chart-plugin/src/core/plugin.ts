import type { FileOps, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { TOOL_NAME, TOOL_DEFINITION } from "./definition";
import { chartArtifactPath } from "./paths";
import { trialDrawProblem } from "./drawProblem";
import { formatProblem, withFormatters } from "./formats";
import { withWordClouds, wordCloudProblem } from "./wordCloud";
import { withMapData } from "./mapData";
import { chartHeightPx } from "./layout";
import { loadMaps, needsBrowser, neededExtensions } from "./extensions";
import { chartOption, chartSources, isChartSource, isReadSourceArgs } from "./source";
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

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

/** `sources`: one or more ranges, and not alongside `source`. */
const isSourceList = (sources: unknown, source: unknown): boolean =>
  source === undefined && Array.isArray(sources) && sources.length > 0 && sources.every(isChartSource);

function isValidChartEntry(value: unknown): value is ChartEntry {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.title)) return false;
  if (!isOptionalString(value.type)) return false;
  if (!isOptionalNumber(value.height)) return false;
  if (value.source !== undefined && !isChartSource(value.source)) return false;
  if (value.sources !== undefined && !isSourceList(value.sources, value.source)) return false;
  return isRecord(value.option);
}

export function isValidChartDocument(value: unknown): value is ChartDocument {
  if (!isRecord(value)) return false;
  if (!isOptionalString(value.title)) return false;
  if (!isOptionalNumber(value.columns)) return false;
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
      message:
        "document must be { charts: [{ option: {...}, title?, type?, height?: number, source? | sources? }, ...], columns?: number } with at least one entry, where source is { spreadsheet, range, layout?: 'table' | 'matrix', groupBy?: { column, x?, value? } } (not both layout matrix and groupBy) and sources a non-empty list of them",
      instructions: "Acknowledge that the chart could not be created and retry with a valid ECharts document shape.",
    };
  }
  if (title !== undefined && typeof title !== "string") {
    return {
      message: "title must be a string when provided",
      instructions: "Acknowledge the error and retry with a string title (or omit it).",
    };
  }

  const sourceRead = await readSources(context, document);
  if ("problem" in sourceRead) {
    return {
      message: sourceRead.problem,
      instructions: "Acknowledge that the chart could not be created. Fix the spreadsheet path or range, or pass the data inline in option instead of source.",
    };
  }
  const drawProblem = await documentDrawProblem(document, sourceRead.rows);
  if (drawProblem) {
    return {
      message: drawProblem,
      instructions: "Acknowledge that the chart could not be drawn, fix that chart's option, and call presentChart again.",
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

type SourceRead = { rows: (ChartSourceRows[] | undefined)[] } | { problem: string };

/** Read every source once, so a wrong path or range reaches the agent now
 *  rather than as a blank chart later. Index-aligned with `document.charts`. */
async function readSources(context: ChartExecuteContext, document: ChartDocument): Promise<SourceRead> {
  if (!document.charts.some((chart) => chartSources(chart).length > 0)) return { rows: [] };
  const { sources } = context;
  if (!sources) return { problem: "This host cannot read a spreadsheet source; pass the chart's data inline in option." };
  const rows: (ChartSourceRows[] | undefined)[] = [];
  for (const chart of document.charts) {
    const read = await readChartRanges(sources, chartSources(chart));
    if (typeof read === "string") return { problem: read };
    rows.push(read);
  }
  return { rows };
}

/** Each range's rows, in order; undefined for a chart with none; or why one could not be read. */
async function readChartRanges(reader: ChartSourceReader, ranges: ChartSource[]): Promise<ChartSourceRows[] | undefined | string> {
  if (ranges.length === 0) return undefined;
  const rows: ChartSourceRows[] = [];
  for (const source of ranges) {
    try {
      rows.push(await reader.read(source));
    } catch (error) {
      return `Cannot read ${source.range} of ${source.spreadsheet}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return rows;
}

/** Draw each chart once off screen, with the rows the View will give it, so an option ECharts
 *  cannot draw reaches the agent now rather than as a blank card. Null when every chart draws.
 *  A 3D chart or a word cloud needs a browser, so only its formats are checked. */
async function documentDrawProblem(document: ChartDocument, rows: (ChartSourceRows[] | undefined)[]): Promise<string | null> {
  const extensions = document.charts.map((chart) => neededExtensions(chart.option));
  await loadMaps(extensions.flatMap(({ maps }) => maps));
  const problems = document.charts.flatMap((chart, index) => {
    const browserOnly = needsBrowser(extensions[index] ?? neededExtensions(chart.option));
    const problem = formatProblem(chart.option) ?? wordCloudProblem(chart.option) ?? (browserOnly ? null : chartDrawProblem(chart, rows[index]));
    return problem ? [`Chart ${index + 1}${chart.title ? ` (${chart.title})` : ""} could not be drawn: ${problem}`] : [];
  });
  return problems.length > 0 ? problems.join("\n") : null;
}

function chartDrawProblem(chart: ChartEntry, rows: ChartSourceRows[] | undefined): string | null {
  try {
    return trialDrawProblem(withMapData(withWordClouds(withFormatters(chartOption(chart, rows, true)))), chartHeightPx(chart));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
