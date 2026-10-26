// A box per column. ECharts' own boxplot transform takes each ROW as a group, while a sheet
// keeps one group per column, so this reads columns instead. The numbers follow ECharts'
// prepareBoxplotData: its quantile, and whiskers at Q1 − k·IQR / Q3 + k·IQR clamped to the data.

const DEFAULT_BOUND_IQR = 1.5;

/** How far the whiskers reach, in IQRs; "none" reaches the minimum and maximum. */
export type BoundIqr = number | "none";

export interface ColumnBox {
  name: string;
  /** low, Q1, median, Q3, high */
  box: [number, number, number, number, number];
  outliers: number[];
}

/** ECharts' quantile of an ascending list. */
function quantile(ascending: number[], fraction: number): number {
  const position = (ascending.length - 1) * fraction;
  const lower = Math.floor(position);
  const below = ascending[lower] ?? 0;
  const above = ascending[lower + 1] ?? below;
  return below + (position - lower) * (above - below);
}

/** The box of `values` (already numbers), or null when there are none. */
export function boxOf(name: string, values: number[], boundIqr: BoundIqr = DEFAULT_BOUND_IQR): ColumnBox | null {
  if (values.length === 0) return null;
  const ascending = [...values].sort((a, b) => a - b);
  const [q1, median, q3] = [0.25, 0.5, 0.75].map((fraction) => quantile(ascending, fraction));
  const min = ascending[0] ?? 0;
  const max = ascending[ascending.length - 1] ?? 0;
  const reach = boundIqr === "none" || boundIqr === 0 ? null : boundIqr * ((q3 ?? 0) - (q1 ?? 0));
  const low = reach === null ? min : Math.max(min, (q1 ?? 0) - reach);
  const high = reach === null ? max : Math.min(max, (q3 ?? 0) + reach);
  return { name, box: [low, q1 ?? 0, median ?? 0, q3 ?? 0, high], outliers: ascending.filter((value) => value < low || value > high) };
}

/** A sheet cell read as a number: a finite number, or text that is one. Anything else is skipped. */
export function cellNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
