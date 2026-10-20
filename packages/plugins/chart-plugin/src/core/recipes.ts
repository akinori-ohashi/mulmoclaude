/** One way of drawing a chart an analyst asks for, written as the ECharts option an agent
 *  would pass. `header` is the first row of the spreadsheet range a sourced recipe reads;
 *  without it, the recipe carries its data inline. */
export interface ChartRecipe {
  use: string;
  header?: readonly string[];
  option: Record<string, unknown>;
}

export const CHART_RECIPES: readonly ChartRecipe[] = [
  {
    use: "scatter of two columns",
    header: ["Temp", "Sales"],
    option: { xAxis: { type: "value" }, yAxis: {}, series: [{ type: "scatter", encode: { x: "Temp", y: "Sales" } }] },
  },
  {
    use: "straight fitted line over the points (Fit = TREND column on the sheet)",
    header: ["Temp", "Sales", "Fit"],
    option: {
      xAxis: { type: "value" },
      yAxis: {},
      series: [
        { type: "scatter", encode: { x: "Temp", y: "Sales" } },
        { type: "line", showSymbol: false, encode: { x: "Temp", y: "Fit" } },
      ],
    },
  },
  {
    use: "pie",
    header: ["Category", "Sales"],
    option: { series: [{ type: "pie", encode: { itemName: "Category", value: "Sales" }, label: { formatter: "{b} {d}%" } }] },
  },
  {
    use: "boxplot (compute the five numbers per group on the sheet with MIN, QUARTILE, MEDIAN, MAX; ECharts' boxplot transform reads rows, not columns)",
    header: ["Group", "Min", "Q1", "Median", "Q3", "Max"],
    option: {
      xAxis: { type: "category" },
      yAxis: {},
      series: [{ type: "boxplot", encode: { x: "Group", y: ["Min", "Q1", "Median", "Q3", "Max"] } }],
    },
  },
  {
    use: "histogram (count each bin on the sheet with COUNTIFS)",
    header: ["Bin", "Count"],
    option: { xAxis: { type: "category" }, yAxis: {}, series: [{ type: "bar", barCategoryGap: "0%" }] },
  },
  {
    use: "two value axes",
    header: ["Month", "Sales", "Growth %"],
    option: {
      xAxis: { type: "category" },
      yAxis: [{}, { axisLabel: { formatter: "{value} %" } }],
      series: [{ type: "bar" }, { type: "line", yAxisIndex: 1 }],
    },
  },
  {
    use: "Pareto (sort descending on the sheet; Cum % = running share)",
    header: ["Cause", "Count", "Cum %"],
    option: {
      xAxis: { type: "category" },
      yAxis: [{}, { max: 100, axisLabel: { formatter: "{value} %" } }],
      series: [{ type: "bar" }, { type: "line", yAxisIndex: 1 }],
    },
  },
  {
    use: "stacked bars (add areaStyle: {} to line series for stacked areas; for 100% stacks, put the shares on the sheet)",
    header: ["Month", "A", "B"],
    option: {
      xAxis: { type: "category" },
      yAxis: {},
      series: [
        { type: "bar", stack: "total" },
        { type: "bar", stack: "total" },
      ],
    },
  },
  {
    use: "waterfall (Base = running total before the step, drawn transparent)",
    header: ["Step", "Base", "Change"],
    option: {
      xAxis: { type: "category" },
      yAxis: {},
      series: [
        { type: "bar", stack: "w", itemStyle: { color: "transparent" } },
        { type: "bar", stack: "w" },
      ],
    },
  },
  {
    use: "dates on a time axis (format the date cells yyyy-mm-dd: a sourced date arrives as its displayed text)",
    header: ["Date", "Visits"],
    option: { xAxis: { type: "time" }, yAxis: {}, series: [{ type: "line", encode: { x: "Date", y: "Visits" } }] },
  },
  {
    use: "average line, highest point and a shaded span",
    header: ["Month", "Sales"],
    option: {
      xAxis: { type: "category" },
      yAxis: {},
      series: [
        {
          type: "line",
          markLine: { data: [{ type: "average", name: "Average" }] },
          markPoint: { data: [{ type: "max", name: "Max" }] },
          markArea: { data: [[{ xAxis: "Feb" }, { xAxis: "Mar" }]] },
        },
      ],
    },
  },
  {
    use: "log scale",
    header: ["Year", "Users"],
    option: { xAxis: { type: "category" }, yAxis: { type: "log" }, series: [{ type: "line" }] },
  },
  {
    use: "heatmap or correlation matrix (one row per cell: X, Y, Value)",
    header: ["X", "Y", "Value"],
    option: {
      xAxis: { type: "category" },
      yAxis: { type: "category" },
      visualMap: { min: -1, max: 1, calculable: true, orient: "horizontal", left: "center", bottom: 0 },
      series: [{ type: "heatmap", encode: { x: "X", y: "Y", value: "Value" }, label: { show: true } }],
    },
  },
  {
    use: "candlestick (the order is open, close, low, high)",
    header: ["Date", "Open", "Close", "Low", "High"],
    option: {
      xAxis: { type: "category" },
      yAxis: { scale: true },
      series: [{ type: "candlestick", encode: { x: "Date", y: ["Open", "Close", "Low", "High"] } }],
    },
  },
  {
    use: "calendar heatmap",
    option: {
      calendar: { range: "2026" },
      visualMap: { min: 0, max: 10, orient: "horizontal", left: "center", bottom: 0 },
      series: [
        {
          type: "heatmap",
          coordinateSystem: "calendar",
          data: [
            ["2026-01-05", 3],
            ["2026-01-06", 8],
          ],
        },
      ],
    },
  },
  {
    use: "radar",
    option: {
      radar: {
        indicator: [
          { name: "Price", max: 10 },
          { name: "Quality", max: 10 },
          { name: "Support", max: 10 },
        ],
      },
      series: [
        {
          type: "radar",
          data: [
            { name: "Ours", value: [7, 9, 6] },
            { name: "Theirs", value: [8, 6, 7] },
          ],
        },
      ],
    },
  },
  {
    use: "treemap (type: sunburst takes the same data)",
    option: {
      series: [
        {
          type: "treemap",
          data: [
            {
              name: "East",
              children: [
                { name: "Tokyo", value: 40 },
                { name: "Chiba", value: 10 },
              ],
            },
            { name: "West", value: 30 },
          ],
        },
      ],
    },
  },
  {
    use: "sankey",
    option: {
      series: [
        {
          type: "sankey",
          data: [{ name: "Visit" }, { name: "Cart" }, { name: "Buy" }],
          links: [
            { source: "Visit", target: "Cart", value: 40 },
            { source: "Cart", target: "Buy", value: 15 },
          ],
        },
      ],
    },
  },
  {
    use: "funnel",
    option: {
      series: [
        {
          type: "funnel",
          data: [
            { name: "Visit", value: 100 },
            { name: "Cart", value: 40 },
            { name: "Buy", value: 15 },
          ],
        },
      ],
    },
  },
  {
    use: "gauge",
    option: { series: [{ type: "gauge", max: 100, detail: { formatter: "{value} %" }, data: [{ value: 72, name: "Target" }] }] },
  },
  {
    use: "parallel coordinates",
    option: {
      parallelAxis: [
        { dim: 0, name: "Price" },
        { dim: 1, name: "Rating" },
        { dim: 2, name: "Sales" },
      ],
      series: [
        {
          type: "parallel",
          data: [
            [12, 4.5, 300],
            [8, 3.9, 520],
          ],
        },
      ],
    },
  },
  {
    use: "many points (thousands or more)",
    header: ["Time", "Value"],
    option: { xAxis: { type: "category" }, yAxis: {}, dataZoom: [{ type: "slider" }], series: [{ type: "line", sampling: "lttb", showSymbol: false }] },
  },
];

const recipeLine = (recipe: ChartRecipe): string => {
  const reads = recipe.header ? ` — source range header ${recipe.header.join(" | ")}` : "";
  return `- ${recipe.use}${reads}: ${JSON.stringify(recipe.option)}`;
};

/** The recipes as the agent reads them, one line each. */
export const chartRecipesText = (): string => CHART_RECIPES.map(recipeLine).join("\n");
