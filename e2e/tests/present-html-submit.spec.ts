import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// A presentHtml page hands a decision back with `mulmo-html-submit`. These drive the real View in
// the real app: a page without the direct flag always asks first, a direct page sends only a message
// carrying the key from its own URL, and nothing another document says — one the page linked to,
// or a result pointing outside artifacts/html/ — gets past the confirmation bar.

const SESSION_ID = "html-submit-session";
const PAGE_PATH = "artifacts/html/2026/10/plan-1.html";
const OUTSIDE_PATH = "docs/report.html";
const LINKED_PATH = "/artifacts/html/2026/10/linked.html";
const LINKED_POSTED_MARKER = "linked page posted";
// Served the same page as PAGE_PATH, so only the URL differs from the canonical one.
const OTHER_PREVIEW_PATH = "/htmlfile/ws/docs/report.html";

const PAGE_HTML = `<!DOCTYPE html><html><body>
<button id="send">Send decision</button>
<button id="nokey">Send without key</button>
<a id="leave" href="${LINKED_PATH}">open report</a>
<script>
  const key = new URLSearchParams(location.hash.slice(1)).get("mulmo-submit-key");
  const post = (extra) => window.parent.postMessage({ type: "mulmo-html-submit", text: "Layout: B", ...extra }, "*");
  document.getElementById("send").onclick = () => post({ key });
  document.getElementById("nokey").onclick = () => post({});
</script></body></html>`;

// Posts while it is still loading, before the iframe's load event, with whatever key its own URL has.
const LINKED_HTML = `<!DOCTYPE html><html><body><script>
  const key = new URLSearchParams(location.hash.slice(1)).get("mulmo-submit-key");
  window.parent.postMessage({ type: "mulmo-html-submit", text: "from the linked page", key }, "*");
</script><p>${LINKED_POSTED_MARKER}</p></body></html>`;

interface ResultOptions {
  submit?: "direct";
  filePath?: string;
  previewUrl?: string;
}

async function setup(page: Page, options: ResultOptions = {}): Promise<string[]> {
  await mockAllApis(page, {
    sessions: [{ id: SESSION_ID, title: "Plan session", roleId: "general", startedAt: "2026-10-22T10:00:00Z", updatedAt: "2026-10-22T10:05:00Z" }],
  });
  const filePath = options.filePath ?? PAGE_PATH;
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Plan this" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "result-html-1",
              toolName: "presentHtml",
              message: "Saved HTML",
              title: "Plan page",
              data: { title: "Plan page", filePath, previewUrl: options.previewUrl ?? `/${PAGE_PATH}`, ...(options.submit ? { submit: options.submit } : {}) },
            },
          },
        ],
      }),
  );
  await page.route(
    (url) => url.pathname === `/${PAGE_PATH}`,
    (route) => route.fulfill({ contentType: "text/html", body: PAGE_HTML }),
  );
  await page.route(
    (url) => url.pathname === OTHER_PREVIEW_PATH,
    (route) => route.fulfill({ contentType: "text/html", body: PAGE_HTML }),
  );
  await page.route(
    (url) => url.pathname === LINKED_PATH,
    (route) => route.fulfill({ contentType: "text/html", body: LINKED_HTML }),
  );
  // The send sink: registered after mockAllApis so it wins Playwright's reverse-order route matching.
  const agentRuns: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/agent",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      agentRuns.push(route.request().postData() ?? "");
      return route.fulfill({ status: 202, json: { chatSessionId: SESSION_ID } });
    },
  );
  return agentRuns;
}

async function openPage(page: Page) {
  await page.goto(`/chat/${SESSION_ID}`);
  await page.getByText("Plan page").first().click();
  const frame = page.frameLocator('[data-testid="present-html-iframe"]');
  await expect(frame.locator("#send")).toBeVisible();
  return frame;
}

test.describe("presentHtml submit", () => {
  test("a page without the direct flag asks first, and Send in the bar delivers it", async ({ page }) => {
    const agentRuns = await setup(page);
    const frame = await openPage(page);
    await frame.locator("#send").click();
    await expect(page.getByTestId("present-html-submit")).toBeVisible();
    expect(agentRuns).toHaveLength(0);
    await page.getByTestId("present-html-submit-send").click();
    await expect.poll(() => agentRuns.length).toBe(1);
    expect(agentRuns[0]).toContain("Layout: B");
  });

  test("a direct page's keyed message is delivered without the bar", async ({ page }) => {
    const agentRuns = await setup(page, { submit: "direct" });
    await openPage(page);
    const src = await page.getByTestId("present-html-iframe").getAttribute("src");
    expect(src).toContain("#mulmo-submit-key=");
    await page.frameLocator('[data-testid="present-html-iframe"]').locator("#send").click();
    await expect.poll(() => agentRuns.length).toBe(1);
    await expect(page.getByTestId("present-html-submit-sent")).toBeVisible();
    await expect(page.getByTestId("present-html-submit")).toHaveCount(0);
  });

  test("a direct page's message without its key goes to the bar", async ({ page }) => {
    const agentRuns = await setup(page, { submit: "direct" });
    const frame = await openPage(page);
    await frame.locator("#nokey").click();
    await expect(page.getByTestId("present-html-submit")).toBeVisible();
    expect(agentRuns).toHaveLength(0);
  });

  test("a document the direct page links to cannot send, even while it is still loading", async ({ page }) => {
    const agentRuns = await setup(page, { submit: "direct" });
    const frame = await openPage(page);
    await frame.locator("#leave").click();
    // The marker renders after the linked page has posted, so reaching it means the attempt was made.
    await expect(page.frameLocator('[data-testid="present-html-iframe"]').locator("body")).toContainText(LINKED_POSTED_MARKER);
    expect(agentRuns).toHaveLength(0);
  });

  test("the direct flag on a result pointing outside artifacts/html/ is ignored", async ({ page }) => {
    const agentRuns = await setup(page, { submit: "direct", filePath: OUTSIDE_PATH });
    const frame = await openPage(page);
    await expect(page.getByTestId("present-html-iframe")).not.toHaveAttribute("src", /mulmo-submit-key/);
    await frame.locator("#send").click();
    await expect(page.getByTestId("present-html-submit")).toBeVisible();
    expect(agentRuns).toHaveLength(0);
  });

  test("the direct flag is ignored when the iframe would load a different URL than the artifact's", async ({ page }) => {
    const agentRuns = await setup(page, { submit: "direct", previewUrl: OTHER_PREVIEW_PATH });
    const frame = await openPage(page);
    await expect(page.getByTestId("present-html-iframe")).not.toHaveAttribute("src", /mulmo-submit-key/);
    await frame.locator("#send").click();
    await expect(page.getByTestId("present-html-submit")).toBeVisible();
    expect(agentRuns).toHaveLength(0);
  });
});
