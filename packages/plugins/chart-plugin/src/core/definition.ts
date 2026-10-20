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
                type: {
                  type: "string",
                  description:
                    "Informational tag shown in the UI (e.g. 'line', 'bar', 'candlestick', 'sankey'). The actual chart type is determined by option.series[].type.",
                },
                option: {
                  type: "object",
                  description: [
                    "Full ECharts option object. Include all series, axes, tooltip, legend, dataset — anything ECharts accepts. Keep data inline; large datasets are fine. With `source`, leave the data out: the chart is drawn with `dataset: { source: rows }` from the spreadsheet, so map columns with series[].encode or the default (first column is the category, each other column a series).",
                    "The option is JSON, so it holds no functions: format with template strings ('{value} %' on an axis label, '{b}: {c}' or '{d}%' on a label), and put any other computed number on the sheet.",
                    "Statistical transforms (ecStat:regression, ecStat:histogram) go in a second dataset whose first one is the source, so they recompute when the sheet changes; a series reads their output with datasetIndex: 1.",
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
                  },
                  required: ["spreadsheet", "range"],
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
