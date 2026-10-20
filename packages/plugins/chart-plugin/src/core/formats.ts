// Number and date formats an agent can write in JSON. The option holds no functions, so a
// `formatter` / `valueFormatter` written as `{ "kind": … }` at one of FORMAT_PLACES is replaced
// with a function before ECharts sees it. Nothing is evaluated: a format is data, read here.

import { echarts } from "./charting";
import { cellNumber } from "./columnBoxes";

interface FormatCommon {
  /** Wraps the formatted value: `{value}`, plus `{a}` series name, `{b}` item name, `{d}` pie percent where ECharts gives them. */
  template?: string;
}

export interface NumberFormat extends FormatCommon {
  kind: "number";
  digits?: number;
  /** Thousands separators; on unless false. */
  grouping?: boolean;
  /** `1.2K`, `3.4M`. */
  compact?: boolean;
  prefix?: string;
  suffix?: string;
}

/** A ratio shown as a percentage: 0.123 → 12.3%. */
export interface PercentFormat extends FormatCommon {
  kind: "percent";
  digits?: number;
}

export interface CurrencyFormat extends FormatCommon {
  kind: "currency";
  /** ISO 4217, e.g. JPY, USD. */
  currency: string;
  digits?: number;
}

/** ECharts' time template, e.g. `{yyyy}-{MM}-{dd}`, `{MMM} {d}`, `{HH}:{mm}`. */
export interface DateFormat extends FormatCommon {
  kind: "date";
  pattern: string;
}

export type ChartFormat = NumberFormat | PercentFormat | CurrencyFormat | DateFormat;

type FormatValue = (value: unknown) => string;

const MAX_DIGITS = 20;
const MISSING_VALUE = "-";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isOptional = (value: unknown, check: (present: unknown) => boolean): boolean => value === undefined || check(value);
const isString = (value: unknown): boolean => typeof value === "string";
const isBoolean = (value: unknown): boolean => typeof value === "boolean";
const isDigits = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_DIGITS;
const isCurrencyCode = (value: unknown): boolean => typeof value === "string" && /^[A-Za-z]{3}$/.test(value);

const KIND_FIELDS: Record<ChartFormat["kind"], Record<string, (value: unknown) => boolean>> = {
  number: { digits: isDigits, grouping: isBoolean, compact: isBoolean, prefix: isString, suffix: isString },
  percent: { digits: isDigits },
  currency: { currency: isCurrencyCode, digits: isDigits },
  date: { pattern: isString },
};
const REQUIRED_FIELDS: Partial<Record<ChartFormat["kind"], string>> = { currency: "currency", date: "pattern" };

// The package targets ES2020, which has no Object.hasOwn; `in` would also find "toString".
const hasOwnKey = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

const isFormatKind = (kind: unknown): kind is ChartFormat["kind"] => typeof kind === "string" && hasOwnKey(KIND_FIELDS, kind);

/** Why `value` is not a format, or null when it is one. */
export function formatShapeProblem(value: Record<string, unknown>): string | null {
  const { kind, template, ...rest } = value;
  if (!isFormatKind(kind)) return `"kind" must be one of ${Object.keys(KIND_FIELDS).join(", ")}`;
  if (!isOptional(template, isString)) return '"template" must be a string';
  const fields = KIND_FIELDS[kind];
  const required = REQUIRED_FIELDS[kind];
  if (required && rest[required] === undefined) return `a ${kind} format needs "${required}"`;
  const wrong = Object.entries(rest).find(([key, field]) => !hasOwnKey(fields, key) || !fields[key]?.(field));
  return wrong ? `"${wrong[0]}" is not a valid field of a ${kind} format` : null;
}

/** A `formatter` object of ours; ECharts has object formatters of its own (a time axis's
 *  `{ year, month, … }`), which carry no `kind`. */
const isFormatObject = (value: unknown): value is Record<string, unknown> => isRecord(value) && "kind" in value;

export function isChartFormat(value: unknown): value is ChartFormat {
  return isRecord(value) && formatShapeProblem(value) === null;
}

const digitsOptions = (digits: number | undefined): Intl.NumberFormatOptions =>
  digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };

function numberFormatter(format: ChartFormat, locale: string | undefined): Intl.NumberFormat | null {
  switch (format.kind) {
    case "number":
      return new Intl.NumberFormat(locale, {
        ...digitsOptions(format.digits),
        useGrouping: format.grouping !== false,
        ...(format.compact ? { notation: "compact" } : {}),
      });
    case "percent":
      return new Intl.NumberFormat(locale, { style: "percent", ...digitsOptions(format.digits) });
    case "currency":
      return new Intl.NumberFormat(locale, { style: "currency", currency: format.currency.toUpperCase(), ...digitsOptions(format.digits) });
    case "date":
      return null;
  }
}

function formatDate(value: unknown, pattern: string): string {
  if (typeof value !== "number" && typeof value !== "string" && !(value instanceof Date)) return String(value);
  const formatted = echarts.time.format(value, pattern, false);
  return formatted.includes("NaN") ? String(value) : formatted;
}

/** The function that writes one value in `format`. A value it cannot read as a number or a
 *  date is shown as it is, so a label never turns blank. */
export function valueFormatter(format: ChartFormat, locale?: string): FormatValue {
  if (format.kind === "date") return (value) => (value === null || value === undefined ? MISSING_VALUE : formatDate(value, format.pattern));
  const numbers = numberFormatter(format, locale);
  const prefix = format.kind === "number" ? (format.prefix ?? "") : "";
  const suffix = format.kind === "number" ? (format.suffix ?? "") : "";
  return (value) => {
    if (value === null || value === undefined) return MISSING_VALUE;
    const number = cellNumber(value);
    return number === null || !numbers ? String(value) : `${prefix}${numbers.format(number)}${suffix}`;
  };
}

/** What ECharts passes a label or axis-pointer formatter. */
interface FormatterParams {
  value?: unknown;
  name?: unknown;
  seriesName?: unknown;
  percent?: unknown;
  encode?: Record<string, number[] | undefined>;
}

// The dimensions a label's number may sit in, most likely first. A dataset row arrives whole, so
// the value is picked out of it by the series' encode.
const VALUE_DIMENSIONS = ["value", "y", "x", "radius", "angle"] as const;
type ValueDimension = (typeof VALUE_DIMENSIONS)[number];

// The axis a dimension is drawn on, and the series key choosing which one.
const DIMENSION_AXES: Partial<Record<ValueDimension, { axis: string; index: string }>> = {
  x: { axis: "xAxis", index: "xAxisIndex" },
  y: { axis: "yAxis", index: "yAxisIndex" },
  radius: { axis: "radiusAxis", index: "polarIndex" },
  angle: { axis: "angleAxis", index: "polarIndex" },
};

// ECharts' own rule for an axis without a type: category when it lists data, value otherwise.
const isCategoryAxis = (axis: unknown): boolean => isRecord(axis) && (axis.type === "category" || (axis.type === undefined && "data" in axis));

function onCategoryAxis(option: Record<string, unknown>, series: Record<string, unknown>, dimension: ValueDimension): boolean {
  const place = DIMENSION_AXES[dimension];
  if (!place) return false;
  const axes = option[place.axis];
  const index = typeof series[place.index] === "number" ? Number(series[place.index]) : 0;
  return isCategoryAxis(Array.isArray(axes) ? axes[index] : axes);
}

/** VALUE_DIMENSIONS with the series' category dimensions last, so a horizontal bar whose
 *  categories are numbers (years) labels its measure on x, not its category on y. */
function labelDimensions(option: Record<string, unknown>, series: Record<string, unknown>): ValueDimension[] {
  const categories = VALUE_DIMENSIONS.filter((dimension) => onCategoryAxis(option, series, dimension));
  return [...VALUE_DIMENSIONS.filter((dimension) => !categories.includes(dimension)), ...categories];
}

function labelValue(params: FormatterParams, dimensions: readonly ValueDimension[]): unknown {
  const { value, encode } = params;
  if (!Array.isArray(value)) return isRecord(value) && "value" in value ? value.value : value;
  const indexes = dimensions.flatMap((dimension) => encode?.[dimension] ?? []);
  const numeric = indexes.map((index) => value[index]).find((cell) => cellNumber(cell) !== null);
  return numeric ?? value[value.length - 1];
}

const textOf = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

function applyTemplate(template: string | undefined, formatted: string, params: FormatterParams | null): string {
  if (template === undefined) return formatted;
  const fields: Record<string, string> = {
    value: formatted,
    a: textOf(params?.seriesName),
    b: textOf(params?.name),
    d: textOf(params?.percent),
  };
  return template.replace(/\{(value|a|b|d)\}/g, (_, field: string) => fields[field] ?? "");
}

type FormatterArgument = "value" | "params";

function formatterFunction(
  format: ChartFormat,
  takes: FormatterArgument,
  locale: string | undefined,
  dimensions: readonly ValueDimension[] = VALUE_DIMENSIONS,
): (input: unknown) => string {
  const write = valueFormatter(format, locale);
  if (takes === "value") return (value) => applyTemplate(format.template, write(value), null);
  return (input) => {
    const params: FormatterParams = isRecord(input) ? input : { value: input };
    return applyTemplate(format.template, write(labelValue(params, dimensions)), params);
  };
}

type FormatPlace = { path: string[]; takes: FormatterArgument };

/** Where a format may stand in for a function, with what ECharts calls it with. `[]` is an
 *  option key that holds one object or an array of them. */
const CHART_PLACES: FormatPlace[] = [
  ...["xAxis[]", "yAxis[]", "radiusAxis[]", "angleAxis[]", "singleAxis[]", "parallelAxis[]"].flatMap((axis) => [
    { path: [axis, "axisLabel", "formatter"], takes: "value" as const },
    { path: [axis, "axisPointer", "label", "formatter"], takes: "params" as const },
  ]),
  { path: ["tooltip[]", "valueFormatter"], takes: "value" },
];
/** The same, inside one series. */
const SERIES_PLACES: FormatPlace[] = [
  { path: ["tooltip", "valueFormatter"], takes: "value" },
  { path: ["label", "formatter"], takes: "params" },
  { path: ["endLabel", "formatter"], takes: "params" },
  { path: ["emphasis", "label", "formatter"], takes: "params" },
];
const FORMAT_PLACES: FormatPlace[] = [...CHART_PLACES, ...SERIES_PLACES.map(({ path, takes }) => ({ path: ["series[]", ...path], takes }))];

const keyOf = (step: string): string => step.replace(/\[\]$/, "");
const listStep = (step: string): boolean => step.endsWith("[]");

function replaceAt(holder: unknown, path: string[], replace: (value: unknown) => unknown): unknown {
  const [step, ...rest] = path;
  if (step === undefined) return replace(holder);
  if (!isRecord(holder) || !(keyOf(step) in holder)) return holder;
  const child = holder[keyOf(step)];
  const next = (value: unknown): unknown => replaceAt(value, rest, replace);
  const replaced = listStep(step) && Array.isArray(child) ? child.map(next) : next(child);
  return { ...holder, [keyOf(step)]: replaced };
}

/** `option` with every format at FORMAT_PLACES replaced by a function. Anything else is kept. */
export function withFormatters(option: Record<string, unknown>, locale?: string): Record<string, unknown> {
  const formatSeries = (series: unknown): unknown =>
    isRecord(series) ? replaceFormats(series, SERIES_PLACES, locale, labelDimensions(option, series)) : series;
  const charted = replaceFormats(option, CHART_PLACES, locale, VALUE_DIMENSIONS);
  const replaced = replaceAt(charted, ["series[]"], formatSeries);
  return isRecord(replaced) ? replaced : charted;
}

function replaceFormats(
  holder: Record<string, unknown>,
  places: FormatPlace[],
  locale: string | undefined,
  dimensions: readonly ValueDimension[],
): Record<string, unknown> {
  return places.reduce<Record<string, unknown>>((current, { path, takes }) => {
    const replaced = replaceAt(current, path, (value) => (isChartFormat(value) ? formatterFunction(value, takes, locale, dimensions) : value));
    return isRecord(replaced) ? replaced : current;
  }, holder);
}

const FORMATTER_KEYS = new Set(["formatter", "valueFormatter"]);

function formatsOutsidePlaces(value: unknown, trail: string[], found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => formatsOutsidePlaces(item, trail, found));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, child]) => {
    const here = [...trail, key];
    if (FORMATTER_KEYS.has(key) && isFormatObject(child)) found.push(here.join("."));
    else formatsOutsidePlaces(child, here, found);
  });
}

/** Why the formats in `option` cannot be used, or null. Run on the option as the agent wrote it,
 *  before `withFormatters`: whatever object is left at a formatter key afterwards was not used. */
export function formatProblem(option: Record<string, unknown>): string | null {
  const shapes: string[] = [];
  FORMAT_PLACES.forEach(({ path }) =>
    replaceAt(option, path, (value) => {
      if (isFormatObject(value)) {
        const problem = formatShapeProblem(value);
        if (problem) shapes.push(`${path.map(keyOf).join(".")}: ${problem}`);
      }
      return value;
    }),
  );
  if (shapes.length > 0) return `Invalid format: ${shapes.join("; ")}`;
  const unused: string[] = [];
  formatsOutsidePlaces(withFormatters(option), [], unused);
  if (unused.length === 0) return null;
  const places = FORMAT_PLACES.map(({ path }) => path.map(keyOf).join(".")).join(", ");
  return `A format object only works at ${places}; not at ${unused.join(", ")}`;
}
