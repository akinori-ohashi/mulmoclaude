// The ECharts the View draws with. Importing it from here registers ecStat's transforms first,
// so no chart is drawn before they exist.
import * as echarts from "echarts";
import { registerStatTransforms } from "./statTransforms";

registerStatTransforms(echarts.registerTransform);

export { echarts };
