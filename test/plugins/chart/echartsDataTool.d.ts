// ECharts ships this extension without types; the boxplot test compares against it.
declare module "echarts/extension/dataTool/prepareBoxplotData" {
  interface BoxplotData {
    /** One [low, Q1, median, Q3, high] per input list. */
    boxData: number[][];
    /** [list index, value] */
    outliers: [number, number][];
    axisData: string[];
  }
  export default function prepareBoxplotData(rawData: number[][], options?: { boundIQR?: number | "none" }): BoxplotData;
}
