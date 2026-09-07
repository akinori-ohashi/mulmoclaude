import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { roleIcon, roleName } from "../../../src/utils/role/icon.js";
import type { Role } from "../../../src/config/roles";

const roles: Role[] = [
  {
    id: "general",
    name: "General",
    icon: "auto_awesome",
    prompt: "",
    availablePlugins: [],
  },
  {
    id: "tutor",
    name: "Tutor",
    icon: "school",
    prompt: "",
    availablePlugins: [],
  },
  {
    id: "broken",
    name: "Broken",
    icon: "🤖", // emoji, not a Material Icon name
    prompt: "",
    availablePlugins: [],
  },
];

describe("roleIcon", () => {
  it("returns the role's icon when it is a valid Material Icon name", () => {
    assert.equal(roleIcon(roles, "general"), "auto_awesome");
    assert.equal(roleIcon(roles, "tutor"), "school");
  });

  it("falls back to smart_toy when the icon is not a name the font can resolve", () => {
    assert.equal(roleIcon(roles, "broken"), "smart_toy");
  });

  // Unknown role must not fall back to `star` — that's the PinToggle glyph
  // for collection shortcuts, and collision made `General` and pinned
  // collections indistinguishable (#1684).
  it("falls back to smart_toy when the role is unknown (never star)", () => {
    assert.equal(roleIcon(roles, "no-such-role"), "smart_toy");
  });

  it("accepts lowercase letters, digits and underscores as valid icons", () => {
    // `123` is a REAL Material Icons name. This case previously expected
    // `smart_toy` — the test asserted the defect, which is why a letters-only
    // pattern survived: it rejected 151 of the 2122 shipped names and every
    // assertion still passed.
    const cases: [icon: string, expected: string][] = [
      ["valid_name", "valid_name"],
      ["123", "123"],
      ["10k", "10k"],
      ["3d_rotation", "3d_rotation"],
      ["18_up_rating", "18_up_rating"],
      ["Has_Caps", "smart_toy"],
      ["with-dash", "smart_toy"],
      ["has space", "smart_toy"],
      ["", "smart_toy"],
      ["🤖", "smart_toy"],
      ["日本語", "smart_toy"],
    ];
    const testRoles: Role[] = cases.map(([icon], index) => ({ id: `role-${index}`, name: "", icon, prompt: "", availablePlugins: [] }));
    cases.forEach(([icon, expected], index) => {
      assert.equal(roleIcon(testRoles, `role-${index}`), expected, icon);
    });
  });

  // The guard that actually prevents this coming back: ask the SHIPPED icon
  // set, not a remembered idea of what its names look like.
  it("accepts every name the shipped Material Icons set declares", () => {
    const require_ = createRequire(import.meta.url);
    const declarations = readFileSync(require_.resolve("material-icons/index.d.ts"), "utf8");
    const names = [...declarations.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
    assert.ok(names.length > 2000, `expected the full icon list, got ${names.length}`);
    const testRoles: Role[] = names.map((icon, index) => ({ id: `n${index}`, name: "", icon, prompt: "", availablePlugins: [] }));
    const rejected = names.filter((icon, index) => roleIcon(testRoles, `n${index}`) !== icon);
    assert.deepEqual(rejected, []);
  });
});

describe("roleName", () => {
  it("returns the role's display name", () => {
    assert.equal(roleName(roles, "general"), "General");
    assert.equal(roleName(roles, "tutor"), "Tutor");
  });

  it("falls back to the id when the role is unknown", () => {
    assert.equal(roleName(roles, "phantom"), "phantom");
  });
});
