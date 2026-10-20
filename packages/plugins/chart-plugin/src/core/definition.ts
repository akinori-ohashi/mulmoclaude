import type { ToolDefinition } from "gui-chat-protocol";
import { chartRecipesText } from "./recipes";

export const TOOL_NAME = "presentChart";

export const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Save and present one or more Apache ECharts visualizations as a single document. Use this for line, bar, area, scatter, pie, candlestick, heatmap, sankey, or graph/network charts — anything ECharts supports. Pass ECharts option object(s) directly; the plugin calls setOption on each one. Use `charts: []` array form even for a single chart so multi-chart dashboards share the same slug. The option's description lists recipes: scatter, fitted line and curve, boxplot, histogram, dual axis, Pareto, stacked, waterfall, time axis, annotations, log scale, heatmap, candlestick, calendar, radar, treemap, sankey, funnel, gauge, parallel, large data.",
  parameters: {
    type: "object",
    properties: {
      document: {
        type: "object",
        description:
          "Chart document. Contains an optional title and an array of chart entries. Each entry has its own ECharts option object that the UI renders independently.",
        properties: {
          title: {
            type: "string",
            description: "Optional human-friendly title for the whole document. Used to derive the file slug and as the preview label.",
          },
          columns: {
            type: "number",
            description: "Optional. Cards side by side, 1–4 (default 1): small multiples per region or year, or a dashboard of several charts.",
          },
          charts: {
            type: "array",
            description: "List of charts to render, in order. Each charts[i].option is passed as-is to ECharts' setOption().",
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Optional short label for this specific chart (shown above it in the UI).",
                },
                height: {
                  type: "number",
                  description:
                    "Optional height in pixels (160–1200, default 400). Taller for a scatter matrix or many grids in one option, shorter for small multiples.",
                },
                type: {
                  type: "string",
                  description:
                    "Informational tag shown in the UI (e.g. 'line', 'bar', 'candlestick', 'sankey'). The actual chart type is determined by option.series[].type.",
                },
                option: {
                  type: "object",
                  description: [
                    "Full ECharts option object. Include all series, axes, tooltip, legend, dataset — anything ECharts accepts. Keep data inline; large datasets are fine. With `source`, leave the data out: the chart is drawn with `dataset: { source: rows }` from the spreadsheet, so map columns with series[].encode or the default (first column is the category, each other column a series).",
                    "The option is JSON, so it holds no functions: format with template strings ('{value} %' on an axis label, '{b}: {c}' or '{d}%' on a label), or with a format object as a formatter / valueFormatter on an axis label, axis pointer label, tooltip or series label: {kind:'number', digits?, grouping?, compact?, prefix?, suffix?}, {kind:'percent', digits?} (0.12 → 12%), {kind:'currency', currency:'JPY'|'USD'|…, digits?}, {kind:'date', pattern:'{yyyy}-{MM}-{dd}'}; each takes template?: '{b}: {value}'. Colour or size by value: visualMap (inRange color / symbolSize). Put any other computed number on the sheet.",
                    "Maps and 3D load when a chart uses them: map series or geo with map 'world' / 'japan' (English names) or 'world-ja' / 'japan-ja' (Japanese names); echarts-gl's scatter3D, bar3D, surface, line3D with grid3D / globe. Word cloud: series type 'wordCloud' with data [{name, value}] or a sheet's word and count columns (encode itemName / value); sizeRange [min, max] px, rotationRange [from, to] degrees within ±90 with rotationStep, gridSize px between words; the largest 300 words, and those that do not fit are left out.",
                    "Statistical transforms (ecStat:regression, ecStat:histogram, mulmo:clustering, mulmo:boxplotColumns) go in a second dataset whose first one is the source, so they recompute when the sheet changes; a series reads their output with datasetIndex: 1.",
                    "Recipes (a sourced recipe names the header its range needs; series without encode take the columns in order):",
                    chartRecipesText(),
                  ].join("\n"),
                },
                source: {
                  type: "object",
                  description:
                    "Optional. Draw this chart from a range of a spreadsheet saved by presentSpreadsheet instead of inline data, so it follows the sheet when the user edits it. The range's first row is the header (series names).",
                  properties: {
                    spreadsheet: {
                      type: "string",
                      description:
                        "The path presentSpreadsheet reported for the saved spreadsheet (absolute, or workspace-relative such as artifacts/spreadsheets/2026/10/abc123.json).",
                    },
                    range: {
                      type: "string",
                      description: "Sheet and range, e.g. Summary!A1:C13. Without a sheet name, the first sheet.",
                    },
                    layout: {
                      type: "string",
                      enum: ["table", "matrix"],
                      description:
                        "matrix: the range is a cross table (categories along the top row and down the first column, e.g. a correlation matrix); it is drawn as one row per cell with the header X, Y, Value, as the heatmap recipe reads.",
                    },
                    groupBy: {
                      type: "object",
                      description:
                        "The range is a long table (e.g. Date, Region, Sales); it is drawn with one column per value of `column` (Date, East, West), so each group becomes a series. Rows meeting in one cell are added up.",
                      properties: {
                        column: { type: "string", description: "Header of the column whose values become the series." },
                        x: { type: "string", description: "Header of the x column. Default: the first other column." },
                        value: { type: "string", description: "Header of the plotted column. Default: the first column that is neither." },
                      },
                      required: ["column"],
                    },
                  },
                  required: ["spreadsheet", "range"],
                },
                sources: {
                  type: "array",
                  description:
                    "Optional, instead of `source`: several ranges, the i-th drawn as dataset[i] (each shaped like `source`), e.g. a lower and an upper bound kept apart; a series picks one with datasetIndex. Transform datasets go after them.",
                  items: { type: "object" },
                },
              },
              required: ["option"],
            },
          },
        },
        required: ["charts"],
      },
      title: {
        type: "string",
        description: "Short label shown in the canvas preview sidebar. Defaults to document.title, or 'Chart' when both are blank.",
      },
    },
    required: ["document"],
  },
};

export default TOOL_DEFINITION;
