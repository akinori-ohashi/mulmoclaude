// Unit tests for `IconGlyph`'s `fontClass` prop
// (packages/core/src/plugin-vue/IconGlyph.ts).
//
// Roles are drawn in Material ICONS while collections use Material SYMBOLS —
// two different sets with their own name lists. Rather than grow a second copy
// of the classify + contain + label logic (the area that took five review
// rounds on #3001), the component takes the font as a parameter.
//
// The property that matters most here is the DEFAULT: twelve existing call
// sites pass no `fontClass`, and every one of them must keep rendering Material
// Symbols exactly as before.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { IconGlyph, type IconGlyphProps } from "@mulmoclaude/core/plugin-vue";

/** Render the functional component and return the vnode's class list.
 *
 *  A functional component is just a function of props, so calling it directly
 *  avoids mounting an app for what is a pure branch on the icon value. `h()`
 *  NORMALISES the class array into a single space-separated string, hence the
 *  split — reading `props.class` as an array silently yields nothing. */
function classesOf(props: IconGlyphProps): string[] {
  const render = IconGlyph as unknown as (p: IconGlyphProps, ctx: unknown) => { props?: Record<string, unknown> };
  const raw = render(props, {}).props?.class;
  if (typeof raw !== "string") return [];
  return raw.split(/\s+/).filter((entry) => entry.length > 0);
}

describe("IconGlyph — fontClass default (backward compatibility)", () => {
  it("uses Material Symbols when no fontClass is given", () => {
    // The twelve collection/feed/launcher call sites rely on this.
    assert.ok(classesOf({ icon: "podcasts" }).includes("material-symbols-outlined"));
  });

  it("keeps the caller's size class alongside the font", () => {
    const classes = classesOf({ icon: "podcasts", sizeClass: "text-2xl" });
    assert.ok(classes.includes("material-symbols-outlined"));
    assert.ok(classes.includes("text-2xl"));
  });
});

describe("IconGlyph — fontClass override", () => {
  it("renders the named font instead of the default", () => {
    const classes = classesOf({ icon: "school", fontClass: "material-icons" });
    assert.ok(classes.includes("material-icons"), classes.join(" "));
    assert.equal(classes.includes("material-symbols-outlined"), false, "the default must not leak through");
  });

  it("applies to any ligature name the pattern accepts, digits included", () => {
    // `123` / `10k` / `3d_rotation` are real Material Icons names (#3001).
    ["123", "10k", "3d_rotation", "18_up_rating"].forEach((icon) => {
      assert.ok(classesOf({ icon, fontClass: "material-icons" }).includes("material-icons"), icon);
    });
  });
});

describe("IconGlyph — a literal glyph never reaches either font", () => {
  it("drops the font class entirely for an emoji", () => {
    // This is the whole reason the roles management screens could not simply
    // take #3001's 1em clip: an emoji is drawn as TEXT, not as a ligature.
    [undefined, "material-icons", "material-symbols-outlined"].forEach((fontClass) => {
      const classes = classesOf({ icon: "🤖", ...(fontClass === undefined ? {} : { fontClass }) });
      assert.equal(classes.includes("material-icons"), false, String(fontClass));
      assert.equal(classes.includes("material-symbols-outlined"), false, String(fontClass));
    });
  });

  it("still carries the caller's size class on the literal-glyph path", () => {
    assert.ok(classesOf({ icon: "🤖", fontClass: "material-icons", sizeClass: "text-xs" }).includes("text-xs"));
  });
});
