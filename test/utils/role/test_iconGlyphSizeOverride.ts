// Guard for a silent styling collision (#3003).
//
// `.material-icons` hard-codes `font-size: 24px`, and a plain Tailwind size
// class is the same specificity — so `size-class="text-xs"` on that path is
// INERT: it computes to 24px, not 12px. Nothing errors; the icon is simply the
// wrong size. Measured against the shipped CSS:
//
//   material-icons  text-xs  -> 24px   (the class did nothing)
//   material-icons !text-xs  -> 12px   (correct)
//
// The repo already solves this with Tailwind's important modifier
// (`SessionRoleIcon.vue` uses `!text-[10px]` for the same reason). This test
// pins the rule at the source level because no runtime assertion can see it:
// on the roles LIST the requested size happens to equal the font's own 24px, so
// a correct and an inert class are indistinguishable there.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Every place that renders `IconGlyph` on the Material Icons font. */
const MATERIAL_ICONS_CALL_SITES = ["src/components/RolesView.vue", "src/plugins/manageRoles/View.vue", "src/plugins/manageRoles/Preview.vue"];

// One `<IconGlyph .../>` tag, captured whole so its attributes can be read.
const ICON_GLYPH_TAG = /<IconGlyph\b[^>]*\/>/g;
const SIZE_CLASS_ATTR = /size-class="([^"]*)"/;

describe("IconGlyph on the Material Icons font — size class must be important", () => {
  MATERIAL_ICONS_CALL_SITES.forEach((relative) => {
    it(`${relative} overrides the font's own 24px`, () => {
      const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
      const tags = source.match(ICON_GLYPH_TAG) ?? [];
      const onMaterialIcons = tags.filter((tag) => tag.includes('font-class="material-icons"'));
      assert.ok(onMaterialIcons.length > 0, `no material-icons IconGlyph found — did this file move?`);

      onMaterialIcons.forEach((tag) => {
        const sizeClass = SIZE_CLASS_ATTR.exec(tag)?.[1];
        assert.ok(sizeClass, `no size-class on ${tag}`);
        assert.ok(
          sizeClass.startsWith("!"),
          `size-class="${sizeClass}" is inert: .material-icons sets font-size:24px at equal specificity, so it needs Tailwind's "!" modifier`,
        );
      });
    });
  });
});
