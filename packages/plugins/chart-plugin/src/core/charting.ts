// The ECharts the View and the server's trial draw with. Importing it from here registers
// ecStat's transforms and our own first, so no chart is drawn before they exist.
import * as echarts from "echarts";
import { registerStatTransforms } from "./statTransforms";
import { OWN_TRANSFORMS } from "./ownTransforms";

registerStatTransforms(echarts.registerTransform);
OWN_TRANSFORMS.forEach((transform) => echarts.registerTransform(transform));

export { echarts };
