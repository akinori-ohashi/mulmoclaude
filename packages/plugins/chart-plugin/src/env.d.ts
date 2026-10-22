declare module "*.css";
// Imported only for what it registers with ECharts; it ships no types.
declare module "echarts-gl" {}

// ECharts ships its dark theme object at this path without types; its own declaration is not exported.
declare module "echarts/lib/theme/dark.js" {
  const theme: Record<string, unknown>;
  export default theme;
}

// ECharts ships its global defaults (the default palette) at this path without types.
declare module "echarts/lib/model/globalDefault.js" {
  const globalDefault: { color: string[] };
  export default globalDefault;
}
