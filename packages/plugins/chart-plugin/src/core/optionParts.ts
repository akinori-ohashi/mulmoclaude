// The parts of an ECharts option that may hold series and components: the option itself and,
// for a timeline, its `baseOption` and each of its `options`.

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

export function optionParts(option: Record<string, unknown>): Record<string, unknown>[] {
  return [option, ...asList(option.baseOption), ...asList(option.options)].filter(isRecord);
}

/** Every entry of `key` (a series list, a component) across the parts. */
export const partsList = (parts: Record<string, unknown>[], key: string): unknown[] => parts.flatMap((part) => asList(part[key]));
