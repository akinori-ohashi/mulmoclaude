// How a schema-authored `icon` value should be drawn.
//
// `CollectionSchema.icon` / `FeedSummary.icon` / `Shortcut.icon` are free
// strings (`z.string().trim().min(1)` — no format constraint), but the
// Material Symbols font resolves an icon from a LIGATURE: a value the font
// has no ligature for is laid out as ordinary text, which overflows a fixed
// icon box and paints over its neighbours (#2986). So the value has to be
// classified before it reaches the font, not after.
//
// Classifying it also turns emoji from "happens to work" into a supported
// way to tell shortcuts apart without adding a text label (#2960).

/** Every one of the 3896 names in `material-symbols/index.d.ts` matches this
 *  (verified against the shipped list; the charset there is exactly
 *  `[0-9_a-z]`). Note the digits — `123`, `10k`, `3d_rotation` are real icon
 *  names, so a letters-only pattern rejects valid ones.
 *
 *  This says "shaped like a name", NOT "is a name the font carries": a typo
 *  such as `not_a_glyph` passes and still fails to resolve. Bounding what any
 *  value can PAINT is the renderer's job — cutting to one grapheme (below)
 *  bounds the character count, not the rendered width, so both branches are
 *  additionally capped in `plugin-vue/IconGlyph.ts`. */
const MATERIAL_SYMBOL_NAME_RE = /^[a-z0-9_]+$/;

/** A resolved icon value: either a ligature name for the icon font, or a
 *  literal glyph (emoji, a single letter) drawn as plain text. */
export type IconGlyph = { kind: "symbol"; name: string } | { kind: "glyph"; text: string };

/** Drawn when neither the value nor the surface's own fallback says anything.
 *  Without it a blank `fallback` resolves to an EMPTY glyph and the surface
 *  renders a hole — this function promises a drawable result for every input,
 *  so the promise needs a floor. */
export const DEFAULT_ICON = "dataset";

/** The first grapheme CLUSTER of `text`.
 *
 *  Splitting by code point instead would drop the variation selector from
 *  `"🎙️"` and leave `"🎙"`, which renders as a monochrome text glyph rather
 *  than the colour emoji — and would cut a ZWJ sequence or a flag into a
 *  meaningless fragment. `Intl.Segmenter` is guarded because it is the one
 *  piece here that an old runtime may not carry. */
function firstGrapheme(text: string): string {
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const { segment } of segmenter.segment(text)) return segment;
    return text;
  } catch {
    return [...text][0] ?? text;
  }
}

/** Classify a schema-authored icon value.
 *
 *  `raw` empty / blank / absent falls back to `fallback` (the per-surface
 *  default such as `"dataset"`), and a blank `fallback` in turn to
 *  {@link DEFAULT_ICON}. Both are classified by the same rule — so a caller
 *  can never smuggle an unrenderable default past the guard, and the result
 *  is always something drawable.
 *
 *  A non-name value is cut to ONE grapheme. That bounds the character count,
 *  not the rendered width — see the containment note in
 *  `plugin-vue/IconGlyph.ts` for the other half. */
export function resolveIconGlyph(raw: string | undefined, fallback: string): IconGlyph {
  const value = (raw ?? "").trim() || fallback.trim() || DEFAULT_ICON;
  if (MATERIAL_SYMBOL_NAME_RE.test(value)) return { kind: "symbol", name: value };
  return { kind: "glyph", text: firstGrapheme(value) };
}
