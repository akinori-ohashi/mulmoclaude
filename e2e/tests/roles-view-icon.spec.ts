// E2E for the roles MANAGEMENT screen's icon rendering (#3003).
//
// This screen deliberately shows the RAW `role.icon` — it is where you edit
// that value, so an emoji has to appear as an emoji. That is exactly why it
// could not take #3001's flat 1em clip: an emoji is drawn as text and runs to
// 1.25em, so the clip would crop it.
//
// Both halves therefore need measuring, and only a real browser with the real
// font can do it: an unresolvable name must NOT push the row apart, and an
// emoji must NOT be cropped.

import { test, expect, type Page, type Locator } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const ROLES = [
  { id: "good", name: "Real Icon", icon: "school", prompt: "", availablePlugins: [], queries: [] },
  // Shaped like a ligature name, but no font carries it — the shape a typo
  // takes (`schoool` for `school`).
  { id: "bad", name: "Unresolvable", icon: "not_a_glyph", prompt: "", availablePlugins: [], queries: [] },
  { id: "emoji", name: "Emoji Icon", icon: "🤖", prompt: "", availablePlugins: [], queries: [] },
];

async function openRolesTab(page: Page): Promise<void> {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/roles",
    (route) => route.fulfill({ json: ROLES }),
  );
  await page.goto("/chat");
  await page.getByTestId("settings-btn").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await page.getByTestId("settings-tab-roles").click();
  await expect(page.getByTestId("roles-view-root")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** The icon span inside one role row.
 *
 *  `:not(:has(span))` picks the INNERMOST span. The list row wraps the glyph in
 *  a colour-carrying span, so `.first()` alone returns that wrapper — whose
 *  font-size is the row's, not the icon's, making every em-based measurement
 *  meaningless. */
function iconOf(page: Page, roleId: string): Locator {
  return page.getByTestId(`role-row-${roleId}`).locator("span:not(:has(span))").first();
}

/** Rendered width relative to the span's own font size. */
async function widthInEm(icon: Locator): Promise<number> {
  return icon.evaluate((node) => {
    const fontSize = Number.parseFloat(getComputedStyle(node).fontSize);
    return Number((node.getBoundingClientRect().width / fontSize).toFixed(2));
  });
}

test.describe("roles management — icon rendering", () => {
  test.beforeEach(async ({ page }) => {
    await openRolesTab(page);
  });

  test("an unresolvable name no longer pushes the row apart", async ({ page }) => {
    // Measured before the fix: 264px against a real glyph's 24px — the role
    // name was shoved to the far right and wrapped onto two lines.
    await expect(page.getByTestId("role-row-bad")).toBeVisible();
    expect(await widthInEm(iconOf(page, "bad"))).toBeLessThanOrEqual(1.3);
  });

  test("an emoji is still drawn as an emoji, and is NOT cropped", async ({ page }) => {
    // The reason this screen could not take a flat 1em clip.
    const icon = iconOf(page, "emoji");
    await expect(icon).toHaveText("🤖");
    expect(await widthInEm(icon)).toBeLessThanOrEqual(1.3);

    // WIDTH alone cannot answer "was it cropped": measured, this emoji's
    // natural advance at 24px is exactly 24px, so a hard 1em clip and the
    // correct rendering are both 1.0em and indistinguishable. What separates
    // them is WHICH containment the span got — the literal-glyph path caps with
    // `max-width: 1.25em` and leaves width free, while the icon-font path fixes
    // `width: 1em`. Asserting the cap is what actually detects over-clipping.
    const box = await icon.evaluate((node) => {
      const style = getComputedStyle(node);
      const fontSize = Number.parseFloat(style.fontSize);
      return {
        maxWidthEm: style.maxWidth === "none" ? null : Number((Number.parseFloat(style.maxWidth) / fontSize).toFixed(2)),
        fontSize,
      };
    });
    expect(box.maxWidthEm).not.toBeNull();
    // The CONTRACT value, not merely "more than 1em": every emoji measured
    // 1.25em, so `GLYPH_CONTAINMENT` caps there. A regression to 1.01em would
    // satisfy "greater than 1" and still crop a wider emoji.
    expect(box.maxWidthEm).toBeGreaterThanOrEqual(1.25);
  });

  test("a real icon name still resolves through the Material Icons font", async ({ page }) => {
    const icon = iconOf(page, "good");
    await expect(icon).toHaveText("school");
    await expect(icon).toHaveClass(/material-icons/);
    // A resolved ligature is exactly 1em — proof the font matched rather than
    // laying the name out as text.
    expect(await widthInEm(icon)).toBeCloseTo(1, 1);
  });

  test("the emoji row never reaches the icon font", async ({ page }) => {
    // Material Icons would swallow it; the literal path must be taken.
    await expect(iconOf(page, "emoji")).not.toHaveClass(/material-icons/);
  });

  test("every row keeps its icon inside one line box", async ({ page }) => {
    await Promise.all(
      ROLES.map(async ({ id }) => {
        const box = await iconOf(page, id).boundingBox();
        if (!box) throw new Error(`${id} has no layout box`);
        expect(box.width).toBeLessThanOrEqual(box.height * 1.35);
      }),
    );
  });
});
