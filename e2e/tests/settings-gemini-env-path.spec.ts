// When the key is NOT the one Settings stores, the tab has to name the file
// it does come from.
//
// The tab used to say a bare `.env`, which reads as "the obvious one" and has
// no obvious one: a terminal launch reads the launch directory, an icon launch
// reads `~/.env` because an icon has no launch directory at all (#2626). Now
// that the key can also be typed here (#871), this line is what distinguishes
// "nothing to do, it is already set elsewhere" from a hunt through dotfiles.
// The path comes from `/api/health`, so the mock supplies it.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const ENV_FILE_PATH = "/Users/example/.env";

/** `/api/health` says a key exists; `/api/secrets` says it is not the stored
 *  one — i.e. the shell or a `.env` is supplying it. */
async function mockEnvSourcedKey(page: Page, envFilePath?: string): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/health",
    (route) =>
      route.fulfill({ json: { status: "OK", geminiAvailable: true, sandboxEnabled: false, ...(envFilePath ? { geminiEnvFilePath: envFilePath } : {}) } }),
  );
  await page.route(
    (url) => url.pathname === "/api/secrets",
    (route) => route.fulfill({ json: { secrets: [{ key: "GEMINI_API_KEY", configured: true, source: "env" }] } }),
  );
}

async function openGeminiTab(page: Page): Promise<void> {
  await page.goto("/chat");
  await expect(page.getByTestId("app-title")).toBeVisible();
  await page.getByTestId("settings-btn").click();
  await page.getByTestId("settings-tab-gemini").click();
}

test.describe("Settings → Gemini", () => {
  test.beforeEach(async ({ page }) => {
    // Registered first, so the per-test routes below win — Playwright checks
    // the last-registered route first.
    await mockAllApis(page);
  });

  test("names the .env path the server reported", async ({ page }) => {
    await mockEnvSourcedKey(page, ENV_FILE_PATH);
    await openGeminiTab(page);
    await expect(page.getByTestId("settings-gemini-env-source")).toContainText(ENV_FILE_PATH);
  });

  test("falls back to the bare filename when health carries no path", async ({ page }) => {
    await mockEnvSourcedKey(page);
    await openGeminiTab(page);
    await expect(page.getByTestId("settings-gemini-env-source")).toContainText(".env");
  });
});
