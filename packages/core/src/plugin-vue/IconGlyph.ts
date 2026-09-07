// The one renderer for a schema-authored `icon` value (collection / feed /
// shortcut), shared by the host and the collection plugin.
//
// Never inline `<span class="material-symbols-outlined">{{ icon }}</span>` for
// one of those values again. The font resolves an icon from a LIGATURE, so a
// value it has no ligature for is laid out as ordinary text — which overflows
// the fixed icon box and paints over the controls beside it (#2986). Routing
// every surface through `resolveIconGlyph` also makes emoji a supported way to
// tell shortcuts apart without adding a text label (#2960).
//
// A functional component rather than an SFC: core builds with plain Vite and
// carries no `@vitejs/plugin-vue`, and adding one to render two spans would
// cost more than it buys.

import { h, type FunctionalComponent, type VNode } from "vue";
import { DEFAULT_ICON, resolveIconGlyph } from "../collection/core/iconGlyph.ts";

// Each prop spells out `| undefined` rather than relying on `?` alone:
// consumers build under `exactOptionalPropertyTypes`, where `icon?: string`
// rejects an explicitly-passed `undefined` — and `:icon="view.icon"` on an
// optional schema field passes exactly that.
export interface IconGlyphProps {
  /** The raw schema value. Blank / absent falls through to `fallback`. */
  icon?: string | undefined;
  /** This surface's default glyph when the collection declares none. */
  fallback?: string | undefined;
  /** Tailwind size class for the glyph (`text-base`, `text-2xl`, …). Owned by
   *  the CALL SITE, never defaulted to a value only this file names — see the
   *  note on containment below. */
  sizeClass?: string | undefined;
  /** Which icon FONT resolves a ligature name. Defaults to Material Symbols,
   *  what collections and feeds use. Roles are drawn in Material Icons — a
   *  different set with its own name list — so those call sites pass
   *  `"material-icons"` (#3003).
   *
   *  Only the font differs: both sets use exactly the charset `[0-9_a-z]`
   *  (measured across all 3896 and 2122 shipped names), so `resolveIconGlyph`
   *  answers "is this shaped like a name" identically for either. */
  fontClass?: string | undefined;
  /** Accessible name for the glyph, on BOTH rendering paths. Pass the
   *  collection / feed title only where the surrounding control has no label
   *  of its own; where it does (a button with its own `aria-label`), leave
   *  this off and the glyph is marked decorative instead of announcing the
   *  name twice. */
  ariaLabel?: string | undefined;
}

const DEFAULT_SIZE_CLASS = "text-base";
const DEFAULT_FONT_CLASS = "material-symbols-outlined";

// Containment is an inline style, NOT Tailwind utilities, and that is
// deliberate — the one place in this repo where a component may not use
// utilities (CLAUDE.md → Styling).
//
// A utility class only exists if some Tailwind build SAW the literal. This
// file is compiled into `@mulmoclaude/core`, and each consumer runs its own
// Tailwind over its own sources: the host's build scans core (verified — the
// enum palette's colours, declared only in `enumColors.ts`, do reach the host
// CSS), but `collection-plugin`'s package build scans only the plugin's own
// src, so a class named solely here is silently absent from its `dist/style.css`.
//
// No example class name is spelled out above, deliberately: `check:plugin-css`
// tokenises this file as source, so a palette class quoted in a COMMENT reads to
// it as one this component renders — and it then demands an `@source` for a
// class nothing here draws.
// A containment rule that evaporates in a packaged consumer leaves exactly the
// overflow this component exists to prevent. An inline style cannot be tree-
// shaken by a scanner and holds for every consumer, present and future.
// (`sizeClass` stays a class precisely because the CALL SITE names it, so the
// caller's own build emits it.)
//
// Widths are measured, not guessed, at font-size 16px:
//   · a resolved ligature — `podcasts`, `rss_feed`, `menu_book`,
//     `3d_rotation` — is EXACTLY 16px (1em);
//   · an unresolved name (`not_a_glyph`) falls back to laying the name out as
//     text: 176px, 11× over;
//   · every emoji tested — `🎙️`, a ZWJ family, a flag, a skin-tone modifier,
//     a tag sequence — is 20px (1.25em), because emoji are drawn wider than
//     the em box.
//
// Hence two different caps. 1em is exact for the icon font and clips only a
// miss. Emoji get 1.25em, which leaves a normal one untouched and bounds the
// case Codex raised on #2988: a cluster whose font lacks the sequence
// decomposes into its parts (a 4-person family → four separate emoji) and is
// otherwise unbounded, even though `resolveIconGlyph` cut it to one grapheme.
const SYMBOL_CONTAINMENT = { display: "inline-block", width: "1em", overflow: "hidden" } as const;
const GLYPH_CONTAINMENT = { display: "inline-block", maxWidth: "1.25em", overflow: "hidden", lineHeight: "1" } as const;

/** Both branches carry the same semantics, and the icon-font one needs them
 *  MORE: its text content is the ligature NAME, so an unlabelled span makes a
 *  screen reader announce "podcasts" / "rss_feed" as content. 48 icon spans
 *  across this repo already mark themselves `aria-hidden`; these are the same
 *  kind of span. */
function labellingFor(ariaLabel: string | undefined): Record<string, string> {
  return ariaLabel ? { role: "img", "aria-label": ariaLabel } : { "aria-hidden": "true" };
}

export const IconGlyph: FunctionalComponent<IconGlyphProps> = (props): VNode => {
  const sizeClass = props.sizeClass ?? DEFAULT_SIZE_CLASS;
  const glyph = resolveIconGlyph(props.icon, props.fallback ?? DEFAULT_ICON);
  const labelling = labellingFor(props.ariaLabel);
  if (glyph.kind === "symbol") {
    return h("span", { class: [props.fontClass ?? DEFAULT_FONT_CLASS, sizeClass], style: SYMBOL_CONTAINMENT, ...labelling }, glyph.name);
  }
  return h("span", { class: sizeClass, style: GLYPH_CONTAINMENT, ...labelling }, glyph.text);
};

IconGlyph.displayName = "IconGlyph";
// Declared so Vue routes these through `props` rather than attribute
// fallthrough. Deliberately WITHOUT runtime `default`s: a default here would
// make each prop resolve as a required `string`, so a caller holding an
// `icon?: string` (every optional schema field) would fail to type-check. The
// defaults live in the body above, once.
IconGlyph.props = {
  icon: String,
  fallback: String,
  sizeClass: String,
  ariaLabel: String,
  fontClass: String,
};
