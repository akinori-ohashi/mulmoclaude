// Minimal module shims so `tsc -p test/tsconfig.json` can follow
// transitive imports into `src/plugins/**/index.ts` (which re-export
// `.vue` components) and `src/main.ts` (which side-effect-imports
// CSS). None of these shapes are actually used by tests — vue-tsc
// handles the real typing via `tsconfig.json` for the main build.

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

declare module "*.css";
declare module "*.scss";
declare module "material-icons/iconfont/material-icons.css";
// chart-plugin imports it only for what it registers with ECharts; it ships no types.
declare module "echarts-gl" {}

interface ImportMeta {
  glob: (pattern: string | readonly string[], options?: { eager?: boolean }) => Record<string, unknown>;
}

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
