// Chart document types — the shared shape between the LLM tool args, the
// server-side write, and the Vue View. Single source of truth, also
// consumed by MulmoTerminal.

/** Where a chart's rows come from instead of inline data: a range of a saved
 *  spreadsheet, read again whenever the chart is shown, so editing the sheet
 *  moves the chart. */
export interface ChartSource {
  /** The workbook, as presentSpreadsheet reported it: absolute, or workspace-relative `artifacts/spreadsheets/…json`. The host resolves it. */
  spreadsheet: string;
  /** `Sheet!A1:C13`, or `A1:C13` for the first sheet. */
  range: string;
  /** `matrix`: the range is a cross table, drawn as one [X, Y, Value] row per cell. */
  layout?: "table" | "matrix";
  /** The range is a long table, drawn as one column (series) per value of `column`. */
  groupBy?: ChartSourceGroupBy;
}

/** Which columns of a long table make the groups, the x values and the plotted values. */
export interface ChartSourceGroupBy {
  column: string;
  /** Default: the first other column. */
  x?: string;
  /** Default: the first column that is neither. */
  value?: string;
}

/** One cell of a source as the chart reads it: a number to plot, a label, or nothing. */
export type ChartSourceCell = string | number | null;

export type ChartSourceRows = ChartSourceCell[][];

export interface ChartEntry {
  title?: string;
  type?: string;
  option: Record<string, unknown>;
  /** When set, the View draws `option` with `dataset: { source: rows }` read from here. */
  source?: ChartSource;
  /** Several ranges instead of `source`: the i-th fills `dataset[i]`. */
  sources?: ChartSource[];
  /** Pixels; kept between 160 and 1200, 400 when left out. */
  height?: number;
}

export interface ChartDocument {
  title?: string;
  charts: ChartEntry[];
  /** Cards side by side, 1 to 4; 1 when left out. */
  columns?: number;
}

/** Tool-call args for presentChart. */
export interface ChartArgs {
  document: ChartDocument;
  title?: string;
}

/** `data` payload returned to the host: drives the View and the
 *  preview sidebar, and records where the document was persisted. */
export interface PresentChartData {
  document: ChartDocument;
  title?: string | undefined;
  filePath: string;
}

/** View → execute, through the runtime's dispatch: the current rows of one source. */
export interface ReadSourceArgs {
  kind: "readSource";
  source: ChartSource;
}

export interface ReadSourceData {
  rows: ChartSourceRows;
}
