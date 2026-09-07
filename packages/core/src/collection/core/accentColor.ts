// A collection's / feed's optional accent colour, drawn as a pale chip behind
// its launcher glyph (#2987).
//
// The point is telling look-alike shortcuts apart when they share a generic
// glyph — `podcasts`, `rss_feed`, `menu_book` are all thin monochrome outlines
// at 16px, and a pill of them reads as one texture (#2960). Measured against
// the alternative: tinting only the glyph leaves too little coloured area to
// register at that size; a pale background does.
//
// Tailwind only detects class names that appear as complete string literals,
// so each colour's classes are spelled out here rather than built from the
// colour name at runtime — the same rule `enumColors.ts` follows, and for the
// same reason.

/** The colours a schema may name, ordered around the hue circle.
 *
 *  Deliberately EXCLUDES the warm band (red / orange / amber): those are the
 *  notification severities (`ENUM_ALERT` red, `ENUM_NUDGE` amber in
 *  `enumColors.ts`) and the launcher's own session badges, so an accent can
 *  never make a shortcut read as "something needs attention".
 *
 *  Seven rather than eight: rendering all eight candidates on one identical
 *  glyph put `cyan` squarely between `sky` and `teal`, so a pill could hold
 *  three shortcuts in the same blue-green band. A colour that cannot be told
 *  from its neighbour identifies nothing, which is the entire job here — the
 *  set is sized for separation, not for count. */
export const ACCENT_COLORS = ["violet", "indigo", "sky", "teal", "emerald", "lime", "fuchsia"] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

// Background + glyph colour as one literal per entry. The 50/700 pair, chosen
// by rendering it: at 16px the GLYPH colour does most of the identifying and the
// 50-level wash is what separates an accented shortcut from a plain white one.
// A heavier fill would make the accent, rather than the icon, the loudest thing
// in a chrome row that is otherwise deliberately quiet.
const CHIP_CLASSES: Readonly<Record<AccentColor, string>> = {
  violet: "bg-violet-50 text-violet-700",
  indigo: "bg-indigo-50 text-indigo-700",
  sky: "bg-sky-50 text-sky-700",
  teal: "bg-teal-50 text-teal-700",
  emerald: "bg-emerald-50 text-emerald-700",
  lime: "bg-lime-50 text-lime-700",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700",
};

/** Narrowing guard: is `value` one of the colours a schema may name? */
export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && Object.hasOwn(CHIP_CLASSES, value);
}

/** The chip classes for `color`, or `null` when there is no accent to draw —
 *  absent, blank, or a name this palette does not carry.
 *
 *  Unknown names fail soft rather than throwing, matching how `icon` is
 *  handled: a schema is user/LLM-authored, and a typo should cost the colour,
 *  not the surface. The caller falls back to its own unstyled treatment. */
export function accentChipClasses(color: string | undefined): string | null {
  if (!isAccentColor(color)) return null;
  return CHIP_CLASSES[color];
}
