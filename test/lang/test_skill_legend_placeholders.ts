// The /skills sidebar legend explains every provenance badge a row can carry,
// and it does so through named i18n slots that View.vue fills with the icons.
// A locale missing one slot renders that badge with nothing explaining it, and
// the type system cannot catch it: every locale has the KEY, the placeholder
// lives inside the string. So the rule is pinned here instead — add a
// provenance and this goes red until all eight locales document it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LOCALES, messages } from "../../src/lang/index.js";
import { skillBadgeMeta } from "../../src/plugins/manageSkills/categories.js";
import type { SkillSource } from "../../src/types/session.js";

const LEGEND_SLOTS = ["{system}", "{project}", "{user}", "{claudePlugin}"] as const;

describe("skills legend placeholders", () => {
  SUPPORTED_LOCALES.forEach((locale) => {
    it(`${locale} documents every provenance badge`, () => {
      const legend = messages[locale].pluginManageSkills.sectionLegendActive;
      LEGEND_SLOTS.forEach((slot) => {
        assert.ok(legend.includes(slot), `${locale} legend is missing ${slot}: ${legend}`);
      });
    });
  });

  it("has one slot per provenance the badge helper can return", () => {
    const sources: SkillSource[] = ["user", "project", "claude-plugin"];
    // `mc-`-prefixed project skills are the fourth provenance (system), so the
    // helper's whole range is these three plus that one.
    const provenances = new Set([...sources.map((source) => skillBadgeMeta({ name: "x", source })), skillBadgeMeta({ name: "mc-x", source: "project" })]);
    assert.equal(provenances.size, LEGEND_SLOTS.length);
  });
});
