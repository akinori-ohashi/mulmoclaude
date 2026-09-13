// Render a raw CLI model id as something a person can read at a glance.
//
// The input comes from the `claude` CLI's `system`/`init` frame, so it is an
// external string: never throw, and show it verbatim rather than dropping it
// when the shape is not one we know. Shapes seen in the wild (CLI 2.1.269):
//
//   claude-haiku-4-5-20251001  →  Haiku 4.5
//   claude-opus-5[1m]          →  Opus 5 · 1M
//   claude-fable-5-1           →  Fable 5.1
//
// The bracket suffix matters more than it looks: it is what distinguishes the
// 1M-context variant, and it only ever appears when the shared
// `~/.claude/settings.json` supplied the model — which is exactly the case
// #2554 could not see.
//
// Parsed by splitting rather than by one matching regex. The natural pattern
// (`claude-([a-z]+)-(\d+(?:-\d+)*)(?:-\d{8})?`) nests a quantifier inside a
// quantifier, and both `security/detect-unsafe-regex` and
// `sonarjs/super-linear-regex` reject that shape. Stated precisely, because
// the test file says the same: those rules reject the SHAPE — no input was
// found that actually made the old pattern backtrack pathologically. This is
// a flagged risk removed, not a measured exploit fixed. Every regex below is
// anchored and flat, so each runs in one pass.

const LOWER_WORD = /^[a-z]+$/;
const DIGITS = /^\d+$/;
const RELEASE_DATE = /^\d{8}$/;

const MODEL_PREFIX = "claude";

/** Trailing `[...]` (e.g. `[1m]`), split off before the id is parsed. */
const splitSuffix = (raw: string): { modelId: string; suffix: string } => {
  if (!raw.endsWith("]")) return { modelId: raw, suffix: "" };
  const open = raw.lastIndexOf("[");
  if (open < 0) return { modelId: raw, suffix: "" };
  return { modelId: raw.slice(0, open), suffix: raw.slice(open + 1, -1) };
};

/** `claude-haiku-4-5-20251001` → `{ family: "haiku", version: "4.5" }`.
 *  Null for anything that is not that shape, so the caller can fall back to
 *  showing the value as-is. */
const parseModelId = (modelId: string): { family: string; version: string } | null => {
  const [prefix, family, ...rest] = modelId.split("-");
  if (rest.length === 0 || prefix !== MODEL_PREFIX || !family || !LOWER_WORD.test(family)) return null;
  // A trailing 8-digit release date is not part of the version. Only dropped
  // when something else remains, so `claude-opus-20250101` keeps its number
  // rather than parsing to a version-less id.
  const last = rest[rest.length - 1];
  const versionParts = rest.length > 1 && last && RELEASE_DATE.test(last) ? rest.slice(0, -1) : rest;
  if (versionParts.length === 0 || !versionParts.every((part) => DIGITS.test(part))) return null;
  return { family, version: versionParts.join(".") };
};

const titleCase = (family: string): string => family.charAt(0).toUpperCase() + family.slice(1);

export function formatModelLabel(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  const { modelId, suffix } = splitSuffix(trimmed);
  const parsed = parseModelId(modelId);
  // Unknown shape: the real value beats a guess, so pass it through whole.
  if (!parsed) return trimmed;
  const label = `${titleCase(parsed.family)} ${parsed.version}`;
  return suffix ? `${label} · ${suffix.toUpperCase()}` : label;
}
