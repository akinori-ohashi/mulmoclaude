// Map, 3D and word cloud support that ECharts does not carry, loaded only for a chart that
// uses it: the maps' GeoJSON and echarts-gl are large, and most charts need none of them.

import { echarts } from "./charting";
import { isRecord, optionParts, partsList } from "./optionParts";

/** What a chart needs beyond ECharts itself. */
export interface ChartExtensions {
  gl: boolean;
  /** A top-level `wordCloud` series, drawn by @modernized/echarts-wordcloud. */
  wordCloud: boolean;
  /** Bundled maps it draws on. */
  maps: BundledMap[];
}

// Series and components that only exist once echarts-gl is loaded.
const GL_SERIES = new Set(["scatter3D", "bar3D", "line3D", "lines3D", "map3D", "surface", "polygons3D", "scatterGL", "graphGL", "flowGL", "linesGL"]);
const GL_COMPONENTS = ["grid3D", "geo3D", "globe", "mapbox3D", "xAxis3D", "yAxis3D", "zAxis3D"];
const WORD_CLOUD = "wordCloud";

/** Maps shipped with the plugin (Natural Earth, public domain): English names, or Japanese with `-ja`. */
export const BUNDLED_MAPS = ["world", "world-ja", "japan", "japan-ja"] as const;
export type BundledMap = (typeof BUNDLED_MAPS)[number];

const isBundledMap = (name: unknown): name is BundledMap => BUNDLED_MAPS.some((map) => map === name);

const seriesTypes = (parts: Record<string, unknown>[]): string[] =>
  partsList(parts, "series").flatMap((series) => (isRecord(series) && typeof series.type === "string" ? [series.type] : []));

/** The map names on map series, `geo` and `geo3D`. */
const mapNames = (parts: Record<string, unknown>[]): unknown[] =>
  [...partsList(parts, "series"), ...partsList(parts, "geo"), ...partsList(parts, "geo3D")].flatMap((holder) => (isRecord(holder) ? [holder.map] : []));

export function neededExtensions(option: Record<string, unknown>): ChartExtensions {
  const parts = optionParts(option);
  const types = seriesTypes(parts);
  return {
    gl: types.some((type) => GL_SERIES.has(type)) || GL_COMPONENTS.some((component) => partsList(parts, component).length > 0),
    wordCloud: types.includes(WORD_CLOUD),
    maps: [...new Set(mapNames(parts).filter(isBundledMap))],
  };
}

/** Whether a chart can only be drawn in a browser: echarts-gl needs WebGL, and the word cloud
 *  extension lays its words out on a DOM canvas, after `setOption` returns. */
export const needsBrowser = (extensions: ChartExtensions): boolean => extensions.gl || extensions.wordCloud;

type Ring = number[][];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };

interface GeoFeature {
  type: "Feature";
  properties: { name: string; name_ja: string };
  geometry: Geometry;
}

interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

const isGeometry = (value: unknown): value is Geometry =>
  isRecord(value) && (value.type === "Polygon" || value.type === "MultiPolygon") && Array.isArray(value.coordinates);

const isGeoFeature = (value: unknown): value is GeoFeature =>
  isRecord(value) &&
  value.type === "Feature" &&
  isRecord(value.properties) &&
  typeof value.properties.name === "string" &&
  typeof value.properties.name_ja === "string" &&
  isGeometry(value.geometry);

// The coordinates are not walked here: the files are ours, and the map test reads every point.
const isGeoCollection = (value: unknown): value is GeoCollection =>
  isRecord(value) && value.type === "FeatureCollection" && Array.isArray(value.features) && value.features.every(isGeoFeature);

/** The same shapes named in Japanese, so a sheet's 東京都 or アメリカ合衆国 finds its region. */
const inJapanese = (geo: GeoCollection): GeoCollection => ({
  ...geo,
  features: geo.features.map((feature) => ({ ...feature, properties: { ...feature.properties, name: feature.properties.name_ja } })),
});

async function geoJsonFor(map: BundledMap): Promise<GeoCollection> {
  const loaded: unknown = map.startsWith("world") ? (await import("../maps/world.json")).default : (await import("../maps/japan.json")).default;
  if (!isGeoCollection(loaded)) throw new Error(`The bundled map "${map}" is not GeoJSON`);
  return map.endsWith("-ja") ? inJapanese(loaded) : loaded;
}

/** Registers each bundled map not registered yet. */
export async function loadMaps(maps: BundledMap[]): Promise<void> {
  const missing = maps.filter((map) => !echarts.getMap(map));
  const loaded = await Promise.all(missing.map(async (map) => [map, await geoJsonFor(map)] as const));
  loaded.forEach(([map, geo]) => echarts.registerMap(map, geo));
}

/** Waits for every load, then fails with the first failure: a fast failure must not let the
 *  charts draw while a map another chart needs is still being registered. */
export async function settleAll(loads: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(loads);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (!failed) return;
  throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
}

/** Loads what the charts need, in a browser: maps, echarts-gl and the word cloud extension. */
export async function loadBrowserExtensions(extensions: ChartExtensions[]): Promise<void> {
  const loads: Promise<unknown>[] = [loadMaps([...new Set(extensions.flatMap(({ maps }) => maps))])];
  if (extensions.some(({ gl }) => gl)) loads.push(import("echarts-gl"));
  if (extensions.some(({ wordCloud }) => wordCloud)) loads.push(import("@modernized/echarts-wordcloud"));
  await settleAll(loads);
}
