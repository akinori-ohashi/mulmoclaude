import ecStat from "echarts-stat";
import type * as echarts from "echarts";

type ExternalTransform = Parameters<typeof echarts.registerTransform>[0];

// Not clustering: its k-means starts from Math.random and does not retry, so it splits even
// well-separated groups wrongly now and then, and differently on each redraw. mulmo:clustering
// (ownTransforms.ts) takes its place.
const STAT_TRANSFORM_NAMES = ["regression", "histogram"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isExternalTransform = (value: unknown): value is ExternalTransform =>
  isRecord(value) && typeof value.type === "string" && typeof value.transform === "function";

/** ecStat's dataset transforms `ecStat:regression` and `ecStat:histogram`.
 *  Its published types predate them, so they are read off the module and checked. */
export function statTransforms(): ExternalTransform[] {
  const transformSet: unknown = Reflect.get(ecStat, "transform");
  if (!isRecord(transformSet)) throw new Error("echarts-stat exports no transform set");
  return STAT_TRANSFORM_NAMES.map((name) => {
    const transform = transformSet[name];
    if (!isExternalTransform(transform)) throw new Error(`echarts-stat has no ${name} transform`);
    return transform;
  });
}

/** Registers the transforms with the ECharts that draws the charts. */
export function registerStatTransforms(registerTransform: (transform: ExternalTransform) => void): void {
  statTransforms().forEach(registerTransform);
}
