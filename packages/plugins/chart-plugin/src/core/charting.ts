// The ECharts the View and the server's trial draw with. Importing it from here registers
// ecStat's transforms, our own and our dark theme first, so no chart is drawn before they exist.
import * as echarts from "echarts";
import { registerStatTransforms } from "./statTransforms";
import { OWN_TRANSFORMS } from "./ownTransforms";
import { DARK_THEME, darkThemeWithAxes3D } from "./darkTheme";

registerStatTransforms(echarts.registerTransform);
OWN_TRANSFORMS.forEach((transform) => echarts.registerTransform(transform));
echarts.registerTheme(DARK_THEME, darkThemeWithAxes3D());

export { echarts };
