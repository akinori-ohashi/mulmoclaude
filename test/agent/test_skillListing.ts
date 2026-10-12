import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { HEAVY_SKILL_COUNT, isSkillListingHeavy, summariseSkillListing } from "../../server/agent/skillListing.ts";
import { _resetSkillListingForTest, getLastSkillListing, noteSkillListing } from "../../server/agent/skillListingState.ts";

const initFrame = (extra: Record<string, unknown>): Record<string, unknown> => ({ type: "system", subtype: "init", ...extra });
const skills = (count: number): string[] => Array.from({ length: count }, (_, index) => `skill-${index}`);

describe("summariseSkillListing", () => {
  it("counts the skills and names only the installed plugins", () => {
    const frame = initFrame({
      skills: skills(3),
      plugins: [
        { name: "tne", path: "/home/u/.claude/plugins/cache/tne" },
        { name: "agents-md", path: "builtin" },
        { name: "mulmocast", path: "/home/u/.claude/plugins/cache/mulmocast" },
      ],
    });
    assert.deepEqual(summariseSkillListing(frame), { skillCount: 3, pluginNames: ["tne", "mulmocast"] });
  });

  it("reports no plugins when the field is absent or malformed", () => {
    assert.deepEqual(summariseSkillListing(initFrame({ skills: [] })), { skillCount: 0, pluginNames: [] });
    assert.deepEqual(summariseSkillListing(initFrame({ skills: [], plugins: "tne" })), { skillCount: 0, pluginNames: [] });
    assert.deepEqual(summariseSkillListing(initFrame({ skills: [], plugins: [null, 42, { path: "/x" }, { name: 7 }] })), { skillCount: 0, pluginNames: [] });
  });

  it("ignores every frame that is not an init carrying a skill list", () => {
    for (const frame of [
      null,
      "init",
      { type: "system", subtype: "hook_started", skills: [] },
      { type: "assistant", subtype: "init", skills: [] },
      initFrame({}),
      initFrame({ skills: "many" }),
    ]) {
      assert.equal(summariseSkillListing(frame), null, JSON.stringify(frame));
    }
  });
});

describe("isSkillListingHeavy", () => {
  it("turns on at the threshold, not before", () => {
    assert.equal(isSkillListingHeavy({ skillCount: HEAVY_SKILL_COUNT - 1, pluginNames: [] }), false);
    assert.equal(isSkillListingHeavy({ skillCount: HEAVY_SKILL_COUNT, pluginNames: [] }), true);
  });
});

describe("noteSkillListing", () => {
  afterEach(() => _resetSkillListingForTest());

  it("keeps the latest init frame's summary with its time and weight", () => {
    assert.equal(getLastSkillListing(), null);
    noteSkillListing(initFrame({ skills: skills(2) }), new Date("2026-10-07T00:00:00Z"));
    noteSkillListing(initFrame({ skills: skills(HEAVY_SKILL_COUNT), plugins: [{ name: "tne", path: "/p" }] }), new Date("2026-10-07T00:01:00Z"));
    assert.deepEqual(getLastSkillListing(), { skillCount: HEAVY_SKILL_COUNT, pluginNames: ["tne"], heavy: true, seenAt: "2026-10-07T00:01:00.000Z" });
  });

  it("leaves the record alone for every other frame", () => {
    noteSkillListing(initFrame({ skills: skills(1) }), new Date("2026-10-07T00:00:00Z"));
    noteSkillListing({ type: "assistant", message: { content: [] } });
    assert.equal(getLastSkillListing()?.skillCount, 1);
  });

  it("warns once per heavy count, even when sessions with different counts interleave", () => {
    const heavyFrame = (count: number): Record<string, unknown> => initFrame({ skills: skills(count) });
    const warned = [HEAVY_SKILL_COUNT, HEAVY_SKILL_COUNT + 1, HEAVY_SKILL_COUNT, HEAVY_SKILL_COUNT + 1, HEAVY_SKILL_COUNT].map((count) =>
      noteSkillListing(heavyFrame(count)),
    );
    assert.deepEqual(warned, [true, true, false, false, false]);
  });

  it("never warns for a listing under the threshold", () => {
    assert.equal(noteSkillListing(initFrame({ skills: skills(HEAVY_SKILL_COUNT - 1) })), false);
    assert.equal(noteSkillListing({ type: "assistant" }), false);
  });
});
