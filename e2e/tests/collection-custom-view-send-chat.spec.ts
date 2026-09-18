// E2E for a custom view's `__MC_VIEW.startChat` (#3062): the prompt is left in
// the composer as an editable DRAFT unless the view's `views[]` entry declares
// `allowSendChat: true`, in which case one press runs the turn.
//
// Drives the real sandboxed iframe and the real postMessage bridge, so it
// covers the whole path a view button takes — bootstrap → parent → host — for
// both the declared and the undeclared view.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { ONE_SECOND_MS } from "../../server/utils/time.ts";

const DRAFT_VIEW = { id: "proposer", label: "Proposer", file: "views/proposer.html", capabilities: ["read"] };
const SEND_VIEW = { id: "runner", label: "Runner", file: "views/runner.html", capabilities: ["read"], allowSendChat: true };

const PROMPT = "Add a note to record a-1";

const DETAIL = {
  collection: {
    slug: "works",
    title: "Works",
    icon: "work",
    source: "user",
    schema: {
      title: "Works",
      icon: "work",
      dataPath: "data/works/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
      views: [DRAFT_VIEW, SEND_VIEW],
    },
  },
  items: [{ id: "a-1" }],
};

// One button that hands the host a prompt. The same HTML is served for both
// views — only the DECLARATION differs, which is the whole point of the flag.
const VIEW_HTML = `<!doctype html><html><head></head><body><button id="go" onclick="window.__MC_VIEW.startChat('${PROMPT}')">Go</button></body></html>`;

async function setup(page: Page): Promise<string[]> {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/works",
    (route) => route.fulfill({ json: DETAIL }),
  );
  // `exp` far in the future so the re-mint timer never rebuilds the frame mid-test.
  await page.route(
    (url) => url.pathname === "/api/collections/works/view-token",
    (route) =>
      route.fulfill({
        json: { token: "tok-123", exp: Date.now() + 3_600_000, dataUrl: "/api/collections/works/view-data", capabilities: ["read"] },
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/works/view-file",
    (route) => route.fulfill({ contentType: "text/html", body: VIEW_HTML }),
  );
  // The auto-send sink: registered after mockAllApis so it wins Playwright's
  // reverse-order route matching.
  const agentRuns: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/agent",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      agentRuns.push(route.request().postData() ?? "");
      return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
    },
  );
  return agentRuns;
}

async function pressGo(page: Page, viewId: string): Promise<void> {
  await page.goto("/collections/works");
  await page.getByTestId(`collection-view-custom-${viewId}`).click();
  const iframe = page.getByTestId("collection-custom-view-iframe");
  await expect(iframe).toBeVisible();
  await page.frameLocator('[data-testid="collection-custom-view-iframe"]').locator("#go").click();
}

test.describe("custom view startChat — draft by default, sent when declared", () => {
  test("a view WITHOUT allowSendChat leaves the prompt as an editable draft", async ({ page }) => {
    const agentRuns = await setup(page);

    await pressGo(page, DRAFT_VIEW.id);

    await expect(page.getByTestId("user-input")).toHaveValue(PROMPT);
    // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- negative assertion: an undeclared view must NOT auto-send; the absence of an /api/agent POST has no observable signal.
    await page.waitForTimeout(0.25 * ONE_SECOND_MS);
    expect(agentRuns).toHaveLength(0);
  });

  test("a view WITH allowSendChat runs the turn on one press", async ({ page }) => {
    const agentRuns = await setup(page);

    await pressGo(page, SEND_VIEW.id);

    await expect.poll(() => agentRuns.length, { timeout: 2 * ONE_SECOND_MS }).toBe(1);
    expect(agentRuns[0]).toContain(PROMPT);
    // Sent, not parked: nothing is left behind in the composer to press Enter on.
    await expect(page.getByTestId("user-input")).toHaveValue("");
  });
});
