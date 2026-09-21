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

// The page the view navigates ITSELF to, and what that page then says. Nothing in
// the sandbox or the CSP stops the navigation, and the replacement document keeps
// the frame's `contentWindow` — so without a guard it passes the host's
// `event.source` check and inherits the view's declared privileges.
const FOREIGN_PATH = "/e2e-foreign-page";
// A deliberately slow subresource: an iframe fires `load` only once its
// subresources settle, so a view holding this still has a PENDING load while the
// user switches away from it.
const SLOW_IMAGE_PATH = "/e2e-slow-image";
const SLOW_IMAGE_DELAY_MS = 1_500;
const FOREIGN_PROMPT = "NAVIGATED DOCUMENT SPEAKING";
// It announces the post AFTER making it, so the test waits on the attempt having
// happened rather than on a clock — a negative assertion is only worth something
// once the thing it denies has demonstrably been tried.
const FOREIGN_POSTED_MARKER = "foreign-posted";
const FOREIGN_HTML = `<!doctype html><html><head></head><body>foreign<script>
window.addEventListener('load', function () {
  parent.postMessage({type:'mc-start-chat',slug:'works',prompt:'${FOREIGN_PROMPT}'}, '*');
  document.body.textContent = '${FOREIGN_POSTED_MARKER}';
});
</script></body></html>`;

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

// One button that hands the host a prompt, and one that navigates the frame AWAY
// to a foreign page (see the navigation test). The same HTML is served for both
// views — only the DECLARATION differs, which is the whole point of the flag.
const VIEW_HTML = `<!doctype html><html><head></head><body>
<button id="go" onclick="window.__MC_VIEW.startChat('${PROMPT}')">Go</button>
<button id="leave" onclick="location.href='${FOREIGN_PATH}'">Leave</button>
</body></html>`;

// Same buttons, plus the slow image — served for the DRAFT view when a test asks
// for it, so switching away leaves that frame's load in flight.
const SLOW_VIEW_HTML = VIEW_HTML.replace("</body>", `<img src="${SLOW_IMAGE_PATH}" alt="" /></body>`);

async function setup(page: Page, options: { slowFirstView?: boolean } = {}): Promise<string[]> {
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
    (route) => {
      const slow = options.slowFirstView === true && new URL(route.request().url()).searchParams.get("id") === DRAFT_VIEW.id;
      return route.fulfill({ contentType: "text/html", body: slow ? SLOW_VIEW_HTML : VIEW_HTML });
    },
  );
  await page.route(
    (url) => url.pathname === SLOW_IMAGE_PATH,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_IMAGE_DELAY_MS));
      return route.fulfill({ status: 404, body: "" });
    },
  );
  await page.route(
    (url) => url.pathname === FOREIGN_PATH,
    (route) => route.fulfill({ contentType: "text/html", body: FOREIGN_HTML }),
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

    // The composer filling IS the signal that the bridge round trip completed —
    // it is the other arm of the same branch — so there is nothing left to wait
    // for before denying the send.
    await expect(page.getByTestId("user-input")).toHaveValue(PROMPT);
    expect(agentRuns).toHaveLength(0);
  });

  test("a foreign document the view navigated to does NOT inherit the send", async ({ page }) => {
    const agentRuns = await setup(page);

    await page.goto("/collections/works");
    await page.getByTestId(`collection-view-custom-${SEND_VIEW.id}`).click();
    await expect(page.getByTestId("collection-custom-view-iframe")).toBeVisible();
    // The view replaces itself with a page the host never installed, which then
    // posts the host's own action message up.
    await page.frameLocator('[data-testid="collection-custom-view-iframe"]').locator("#leave").click();
    // The marker appears only after the foreign page has posted, so reaching this
    // line means the attempt was made and the host declined it. If the host had
    // ACCEPTED it, `startChat` would navigate the app to the new chat and take
    // this frame off screen — hence the message, since that failure surfaces here
    // rather than on the count below.
    const frameBody = page.frameLocator('[data-testid="collection-custom-view-iframe"]').locator("body");
    await expect(
      frameBody,
      "the foreign page should still be on screen with its marker; a missing frame means the host accepted its message and navigated away",
    ).toContainText(FOREIGN_POSTED_MARKER);
    expect(agentRuns).toHaveLength(0);
  });

  test("switching away from a still-loading view does not disarm the one switched to", async ({ page }) => {
    const agentRuns = await setup(page, { slowFirstView: true });

    await page.goto("/collections/works");
    // The draft view's frame mounts but its load stays pending on the slow image.
    await page.getByTestId(`collection-view-custom-${DRAFT_VIEW.id}`).click();
    await expect(page.getByTestId("collection-custom-view-iframe")).toBeVisible();
    // Switch while that load is in flight: its late `load` must not be counted
    // against the frame that replaces it.
    await page.getByTestId(`collection-view-custom-${SEND_VIEW.id}`).click();
    await page.frameLocator('[data-testid="collection-custom-view-iframe"]').locator("#go").click();

    await expect.poll(() => agentRuns.length, { timeout: 5 * ONE_SECOND_MS }).toBe(1);
    expect(agentRuns[0]).toContain(PROMPT);
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
