// Settings → Gemini is where the API key is entered (#871).
//
// Before this, the only way to supply one was a `.env` file the user had to
// create in a directory they had to work out — and from an icon launch there
// is no such directory to speak of. What is pinned here is the path a
// non-engineer takes: open Settings, see that nothing is configured, paste,
// save, and see it stick. Plus the two states that used to be indistinguishable
// — a key stored by the app, and one coming from the shell.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const ENV_FILE_PATH = "/Users/example/.env";

type Source = "gui" | "env" | "none";

/** Stateful `/api/secrets` mock: PUT flips the source to `gui`, DELETE back to
 *  whatever the shell had. Registered AFTER mockAllApis so it wins. */
async function mockSecrets(page: Page, opts: { initial: Source; shellHasKey?: boolean }): Promise<void> {
  let source: Source = opts.initial;
  await page.route(
    (url) => url.pathname === "/api/secrets",
    async (route) => {
      const method = route.request().method();
      if (method === "PUT") source = "gui";
      if (method === "DELETE") source = opts.shellHasKey ? "env" : "none";
      await route.fulfill({ json: { secrets: [{ key: "GEMINI_API_KEY", configured: source !== "none", source }] } });
    },
  );
}

async function openGeminiTab(page: Page): Promise<void> {
  await page.goto("/chat");
  await expect(page.getByTestId("app-title")).toBeVisible();
  await page.getByTestId("settings-btn").click();
  await page.getByTestId("settings-tab-gemini").click();
  await expect(page.getByTestId("settings-gemini-tab")).toBeVisible();
}

test.describe("Settings → Gemini key", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("pasting a key and saving reports it as stored by the app", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/health",
      (route) => route.fulfill({ json: { status: "OK", geminiAvailable: false, geminiEnvFilePath: ENV_FILE_PATH, sandboxEnabled: false } }),
    );
    await mockSecrets(page, { initial: "none" });
    await openGeminiTab(page);

    await expect(page.getByTestId("settings-gemini-status")).toHaveText(/not configured/i);
    // Nothing to save yet, so the button must not offer to.
    await expect(page.getByTestId("settings-gemini-save-btn")).toBeDisabled();

    await page.getByTestId("settings-gemini-api-key-input").fill("AIzaExampleKey");
    await page.getByTestId("settings-gemini-save-btn").click();

    await expect(page.getByTestId("settings-gemini-status")).toHaveText(/saved in the app/i);
    // The field is cleared because the server never sends the value back —
    // leaving the typed key on screen would suggest it round-tripped.
    await expect(page.getByTestId("settings-gemini-api-key-input")).toHaveValue("");
    await expect(page.getByTestId("settings-gemini-clear-btn")).toBeVisible();
  });

  test("says so when the key comes from the shell, and names the .env", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/health",
      (route) => route.fulfill({ json: { status: "OK", geminiAvailable: true, geminiEnvFilePath: ENV_FILE_PATH, sandboxEnabled: false } }),
    );
    await mockSecrets(page, { initial: "env", shellHasKey: true });
    await openGeminiTab(page);

    await expect(page.getByTestId("settings-gemini-status")).toHaveText(/environment/i);
    // There is nothing here to clear: the value lives somewhere this UI does
    // not own, so offering a Clear button would lie about what it can do.
    await expect(page.getByTestId("settings-gemini-clear-btn")).toHaveCount(0);
    await expect(page.getByTestId("settings-gemini-env-source")).toContainText(ENV_FILE_PATH);
  });

  test("clearing a stored key hands it back to the shell value", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/health",
      (route) => route.fulfill({ json: { status: "OK", geminiAvailable: true, geminiEnvFilePath: ENV_FILE_PATH, sandboxEnabled: false } }),
    );
    await mockSecrets(page, { initial: "gui", shellHasKey: true });
    await openGeminiTab(page);

    await expect(page.getByTestId("settings-gemini-status")).toHaveText(/saved in the app/i);
    await page.getByTestId("settings-gemini-clear-btn").click();
    await expect(page.getByTestId("settings-gemini-status")).toHaveText(/environment/i);
  });

  test("the tab stays reachable once a key is configured", async ({ page }) => {
    // It used to disappear when a key was present, which is precisely when
    // you would open it to replace or remove one.
    await page.route(
      (url) => url.pathname === "/api/health",
      (route) => route.fulfill({ json: { status: "OK", geminiAvailable: true, geminiEnvFilePath: ENV_FILE_PATH, sandboxEnabled: false } }),
    );
    await mockSecrets(page, { initial: "gui" });
    await page.goto("/chat");
    await expect(page.getByTestId("app-title")).toBeVisible();
    await page.getByTestId("settings-btn").click();
    await expect(page.getByTestId("settings-tab-gemini")).toBeVisible();
  });
});
