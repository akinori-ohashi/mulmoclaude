// A map series that reads its regions from a dataset paints every region with no row in the
// series' palette colour, not the empty colour `series.data` leaves them in (ECharts 6.1.0), so on
// a visualMap scale the regions with no data read as the largest. A map series reading a sheet
// range therefore gets its rows written into `data` here.

import { asList, isRecord } from "./optionParts";
import { datasetNamedAmounts, readsDatasetRows } from "./seriesDataset";

// Replaced by `data`: left in, `encode` would still point ECharts at the dataset.
const REWRITTEN = ["data", "datasetIndex", "encode"];

const isMapSeries = (series: unknown): series is Record<string, unknown> => isRecord(series) && series.type === "map";

const hasOwnData = (series: Record<string, unknown>): boolean => Array.isArray(series.data) && series.data.length > 0;

function mapSeries(option: Record<string, unknown>, series: Record<string, unknown>): Record<string, unknown> {
  if (hasOwnData(series) || !readsDatasetRows(option, series)) return series;
  const rest = Object.fromEntries(Object.entries(series).filter(([key]) => !REWRITTEN.includes(key)));
  return { ...rest, data: datasetNamedAmounts(option, series) };
}

/** `option` with each top-level map series that reads a dataset's rows given them as `data`. Anything else is kept. */
export function withMapData(option: Record<string, unknown>): Record<string, unknown> {
  const { series } = option;
  if (!asList(series).some(isMapSeries)) return option;
  const drawn = (entry: unknown): unknown => (isMapSeries(entry) ? mapSeries(option, entry) : entry);
  return { ...option, series: Array.isArray(series) ? series.map(drawn) : drawn(series) };
}
