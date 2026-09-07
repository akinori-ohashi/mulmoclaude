// E2E for the role icon's RENDERED geometry (#3001).
//
// `roleIcon()` answers "is this shaped like a name", which it must: knowing
// which of the 2122 names the font actually carries would mean shipping the
// list to the browser and keeping it in step with the font. So an undeclared
// but well-shaped value still reaches the icon font, where it is laid out as
// ordinary TEXT — `999999` draws 176px against a real glyph's 16px, and at the
// empty-state's `text-5xl` that is over 500px.
//
// The unit test in `test/utils/role/test_icon.ts` cannot see any of that: it
// asserts what the helper RETURNS. Containment lives in the templates, so only
// a real browser measuring a real span can tell whether it is still applied —
// which is the point of this file. A later template edit that drops the class
// must fail here while the helper test stays green.

import { test, expect, type Page, type Locator } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A } from "../fixtures/sessions";

// A value the pattern accepts and the font cannot resolve — the shape a real
// typo takes once digits are legal (`10k` is real, `999999` is not).
const UNDECLARED_ICON = "999999";
const ROLE_ID = "general";

// `mergeRoles` lets a custom role REPLACE a built-in of the same id, so
// overriding `general` puts the bad icon on the role the seeded session
// already runs under — no session plumbing required.
const ROLES = [
  {
    id: ROLE_ID,
    name: "Overflowing Role",
    icon: UNDECLARED_ICON,
    prompt: "",
    availablePlugins: [],
    queries: [],
  },
];

async function seedRole(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith("/api/roles"),
    (route) => route.fulfill({ json: ROLES }),
  );
}

/** Width of the span relative to its own font size. A resolved ligature is
 *  exactly 1em; unresolved text laid out by the font is many times that. */
async function widthInEm(icon: Locator): Promise<number> {
  return icon.evaluate((node) => {
    const fontSize = Number.parseFloat(getComputedStyle(node).fontSize);
    return Number((node.getBoundingClientRect().width / fontSize).toFixed(2));
  });
}

test.describe("role icon containment", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page, { sessions: [{ ...SESSION_A, roleId: ROLE_ID }] });
    await seedRole(page);
    await page.goto("/chat");
    await page.evaluate(() => document.fonts.ready);
  });

  test("an undeclared icon name stays one em wide instead of laying out as text", async ({ page }) => {
    // Every span that renders `roleIcon()`'s result, wherever it is on screen.
    const icons = page.locator("span.material-icons").filter({ hasText: UNDECLARED_ICON });
    const count = await icons.count();
    // If this is 0 the test is measuring nothing — fail loudly rather than pass
    // vacuously, which is how a geometry test quietly stops guarding anything.
    expect(count).toBeGreaterThan(0);

    const widths = await Promise.all(Array.from({ length: count }, (_unused, index) => widthInEm(icons.nth(index))));
    widths.forEach((width) => expect(width).toBeLessThanOrEqual(1.01));
  });

  test("the same span never pushes past its own line box", async ({ page }) => {
    const icon = page.locator("span.material-icons").filter({ hasText: UNDECLARED_ICON }).first();
    await expect(icon).toBeVisible();
    const box = await icon.boundingBox();
    if (!box) throw new Error("role icon has no layout box");
    // 1em at the smallest role-icon size is 12px; the uncontained literal is
    // 11x its font size, so any real regression is far outside this bound.
    expect(box.width).toBeLessThanOrEqual(box.height * 1.01);
  });

  // Stack mode has its OWN two renderers (header + its mirror of the
  // empty-state hero). They are a separate copy of the same markup, so the
  // single-layout assertions above say nothing about them — losing the class
  // in one layout and not the other is exactly the drift worth catching.
  test("stack mode contains the same undeclared icon", async ({ page }) => {
    // The toggle's testid names the CURRENT mode, so this one switches to stack.
    await page.getByTestId("canvas-view-toggle-single").click();
    await expect(page.getByTestId("stack-role-header")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const icons = page.locator("span.material-icons").filter({ hasText: UNDECLARED_ICON });
    const count = await icons.count();
    expect(count).toBeGreaterThan(0);
    const widths = await Promise.all(Array.from({ length: count }, (_unused, index) => widthInEm(icons.nth(index))));
    widths.forEach((width) => expect(width).toBeLessThanOrEqual(1.01));
  });

  test("a real icon name is untouched by the containment", async ({ page }) => {
    await page.route(
      (url) => url.pathname.endsWith("/api/roles"),
      (route) => route.fulfill({ json: [{ ...ROLES[0], icon: "school" }] }),
    );
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    const icon = page.locator("span.material-icons").filter({ hasText: "school" }).first();
    await expect(icon).toBeVisible();
    // A resolved ligature is exactly 1em — the cap must not be clipping it.
    expect(await widthInEm(icon)).toBeCloseTo(1, 1);
  });
});
