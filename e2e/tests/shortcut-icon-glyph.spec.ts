// E2E for the launcher shortcut GLYPH (#2986 / #2960).
//
// `schema.icon` is a free string, but the Material Symbols font resolves
// icons from LIGATURES — a value it has no ligature for is laid out as
// ordinary text and paints over the buttons beside it. This is measured
// rather than asserted on markup: the check that matters is geometric (does
// the glyph stay inside its 32px button), and only a real browser with the
// real font loaded can answer it.
//
// It also pins the other half: an emoji is a SUPPORTED way to tell
// look-alike shortcuts apart without adding a text label.

import { test, expect, type Page, type Locator } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Icons covering the three cases — a name the font resolves, a name it does
// NOT (the shape a real typo takes: still lowercase-with-underscores, so the
// name pattern alone lets it through), and an emoji. The awkward ones sit in
// the middle so an overflow lands on a neighbour rather than off the end.
const SEEDED_SHORTCUTS = [
  { kind: "collection", slug: "podcasts", title: "Podcasts", icon: "podcasts" },
  { kind: "collection", slug: "typo", title: "Typo Icon", icon: "not_a_glyph" },
  { kind: "collection", slug: "emoji", title: "Emoji Icon", icon: "🎙️" },
  // One grapheme, but four code points joined by ZWJ. A font without the
  // sequence draws the parts side by side, so the grapheme cut alone does not
  // bound what this paints.
  { kind: "collection", slug: "zwj", title: "Family Emoji", icon: "👨‍👩‍👧‍👦" },
  { kind: "collection", slug: "feeds", title: "Feeds", icon: "rss_feed" },
  // Accent colour (#2987): the same generic glyph, told apart by its chip.
  { kind: "collection", slug: "tinted", title: "Tinted", icon: "rss_feed", color: "violet" },
  // A name outside the palette must degrade to the unstyled default, not throw.
  { kind: "collection", slug: "badcolor", title: "Bad Colour", icon: "rss_feed", color: "puce" },
];

/** Seed the shortcut list. Registered AFTER `mockAllApis` — Playwright checks
 *  routes last-registered-first, so this replaces the fixture's empty
 *  stateful list. */
async function seedShortcuts(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/shortcuts",
    (route) => route.fulfill({ json: { shortcuts: SEEDED_SHORTCUTS } }),
  );
}

function shortcutButton(page: Page, slug: string): Locator {
  return page.getByTestId(`plugin-launcher-shortcut-collection-${slug}`);
}

/** How far the rendered glyph spills outside its button, in CSS pixels. */
async function overflowPx(button: Locator): Promise<number> {
  const box = await button.boundingBox();
  const glyph = await button.locator("span").first().boundingBox();
  if (!box || !glyph) throw new Error("shortcut button or its glyph has no layout box");
  return Math.max(0, box.x - glyph.x, glyph.x + glyph.width - (box.x + box.width));
}

test.describe("launcher shortcut icon glyph", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await seedShortcuts(page);
    await page.goto("/chat");
    await expect(shortcutButton(page, "podcasts")).toBeVisible();
    // The icon font decides the glyph's width, so nothing here is meaningful
    // until it has actually loaded.
    await page.evaluate(() => document.fonts.ready);
  });

  test("an unresolvable icon name stays inside its button instead of covering its neighbours", async ({ page }) => {
    // Without the guard this renders the literal text "not_a_glyph", which is
    // several times wider than the 32px button.
    expect(await overflowPx(shortcutButton(page, "typo"))).toBeLessThanOrEqual(1);

    // And the buttons on either side stay reachable at their own centres —
    // the actual damage an overflow does.
    await Promise.all(
      ["podcasts", "feeds"].map(async (slug) => {
        const box = await shortcutButton(page, slug).boundingBox();
        if (!box) throw new Error(`${slug} has no layout box`);
        const topmost = await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.closest("button")?.getAttribute("data-testid") ?? null, {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        });
        expect(topmost).toBe(`plugin-launcher-shortcut-collection-${slug}`);
      }),
    );
  });

  test("every shortcut keeps the same 32px footprint whatever its icon value", async ({ page }) => {
    const widths = await Promise.all(SEEDED_SHORTCUTS.map(async ({ slug }) => (await shortcutButton(page, slug).boundingBox())?.width));
    expect(widths).toEqual(SEEDED_SHORTCUTS.map(() => 32));
  });

  test("no icon value paints outside its button — including a multi-code-point emoji", async ({ page }) => {
    // The grapheme cut bounds the character count, not the rendered width, so
    // this asserts the property that actually matters for every seeded case.
    const overflows = await Promise.all(SEEDED_SHORTCUTS.map(({ slug }) => overflowPx(shortcutButton(page, slug))));
    expect(overflows).toEqual(SEEDED_SHORTCUTS.map(() => 0));
  });

  test("an emoji icon renders as itself, not through the icon font", async ({ page }) => {
    const glyph = shortcutButton(page, "emoji").locator("span").first();
    await expect(glyph).toHaveText("🎙️");
    // The ligature font would swallow it; a literal glyph must not carry that class.
    await expect(glyph).not.toHaveClass(/material-symbols-outlined/);
    expect(await overflowPx(shortcutButton(page, "emoji"))).toBeLessThanOrEqual(1);
  });

  test("a valid Material Symbols name still goes to the icon font", async ({ page }) => {
    const glyph = shortcutButton(page, "podcasts").locator("span").first();
    await expect(glyph).toHaveText("podcasts");
    await expect(glyph).toHaveClass(/material-symbols-outlined/);
  });

  test("no glyph leaks its text content to assistive tech", async ({ page }) => {
    // The icon-font span's text IS the ligature name, so an unlabelled one
    // makes a screen reader announce "podcasts". The button already carries
    // the title as its own aria-label, so every glyph here is decorative.
    await Promise.all(
      SEEDED_SHORTCUTS.map(async ({ slug, title }) => {
        const button = shortcutButton(page, slug);
        await expect(button).toHaveAttribute("aria-label", title);
        await expect(button.locator("span").first()).toHaveAttribute("aria-hidden", "true");
      }),
    );
  });
});

test.describe("launcher shortcut accent colour", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await seedShortcuts(page);
    await page.goto("/chat");
    await expect(shortcutButton(page, "podcasts")).toBeVisible();
  });

  // The palette's literals live ONLY in @mulmoclaude/core, and a Tailwind build
  // that does not scan core emits nothing for them — silently, since the class
  // stays on the element either way (#2989). So this reads the COMPUTED colour
  // rather than the class list: it is the only form that fails when the CSS is
  // missing.
  test("a shortcut with an accent colour paints a tinted background", async ({ page }) => {
    const tinted = await shortcutButton(page, "tinted").evaluate((node) => getComputedStyle(node).backgroundColor);
    const plain = await shortcutButton(page, "feeds").evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(tinted).not.toBe(plain);
    // Not merely "different" — the class has to have produced real CSS.
    // Tailwind v4 emits oklch(), so match any colour function rather than rgb().
    expect(tinted).toMatch(/^(?:rgba?|oklch|color|lab|lch)\(/);
    expect(tinted).not.toBe("rgba(0, 0, 0, 0)");
    expect(tinted).not.toBe("transparent");
  });

  test("a colour outside the palette falls back to the plain treatment", async ({ page }) => {
    const bad = await shortcutButton(page, "badcolor").evaluate((node) => getComputedStyle(node).backgroundColor);
    const plain = await shortcutButton(page, "feeds").evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(bad).toBe(plain);
  });

  test("shortcuts without a colour are unchanged", async ({ page }) => {
    const plain = await shortcutButton(page, "podcasts").evaluate((node) => getComputedStyle(node).backgroundColor);
    // white — the pre-accent default
    expect(plain).toBe("rgb(255, 255, 255)");
  });

  test("the accent never changes the 32px footprint", async ({ page }) => {
    const widths = await Promise.all(SEEDED_SHORTCUTS.map(async ({ slug }) => (await shortcutButton(page, slug).boundingBox())?.width));
    expect(widths).toEqual(SEEDED_SHORTCUTS.map(() => 32));
  });
});

// Deliberately no `toHaveScreenshot` baseline. The suite runs on Linux in CI
// and on macOS locally, and an emoji is drawn by whichever emoji font the host
// carries — a pixel baseline would encode the author's machine, not the
// behaviour. Everything above is measured geometry or which font path the
// value took, which is what actually regressed and is the same on both.
