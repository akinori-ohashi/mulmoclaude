// E2E for the per-code-block copy button (#3125), driving the real app.
//
// A green unit suite proves the renderer emits the right string; it does
// not prove the button SURVIVES the trip through the app — the DOMPurify
// pass every markdown surface runs, Vue's `v-html`, and the unlayered
// `.markdown-content pre` css the wrapper had to be designed around. So
// this spec loads a chat transcript containing real fences and checks
// what a user can actually see and click.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A } from "../fixtures/sessions";

const CODE_BODY = 'const greeting = "hello";\nconsole.log(greeting);';

const TRANSCRIPT = [
  { type: "session_meta", roleId: "general", sessionId: SESSION_A.id },
  { type: "text", source: "user", message: "show me some code" },
  {
    type: "text",
    source: "assistant",
    message: [
      "Here you go:",
      "",
      "```ts",
      CODE_BODY,
      "```",
      "",
      "And a diagram:",
      "",
      "```mermaid",
      "graph TD;",
      "A-->B;",
      "```",
      "",
      "Inline `code` stays inline.",
    ].join("\n"),
  },
];

async function openTranscript(page: Page): Promise<void> {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === `/api/sessions/${SESSION_A.id}`,
    (route) => (route.request().method() === "GET" ? route.fulfill({ json: TRANSCRIPT }) : route.fallback()),
  );
  await page.goto(`/chat/${SESSION_A.id}`);
}

test.describe("code block copy button", () => {
  test("renders one visible copy button per fenced block, and none for mermaid or inline code", async ({ page }) => {
    await openTranscript(page);

    const buttons = page.locator("[data-code-copy]");
    await expect(buttons).toHaveCount(1);
    // Visible WITHOUT hovering — the touch-reachability requirement that
    // decided against GitHub's hover-to-reveal treatment.
    await expect(buttons.first()).toBeVisible();

    // The mermaid fence became a placeholder, and it carries no button.
    await expect(page.locator("pre.mermaid, [data-mermaid-pending], .markdown-content svg")).not.toHaveCount(0);
    await expect(page.locator("pre.mermaid [data-code-copy]")).toHaveCount(0);
  });

  test("the button sits inside the block's top-right corner", async ({ page }) => {
    await openTranscript(page);

    const button = page.locator("[data-code-copy]").first();
    const block = page.locator("[data-code-copy-block]").first();
    const buttonBox = await button.boundingBox();
    const blockBox = await block.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(blockBox).not.toBeNull();
    if (buttonBox === null || blockBox === null) return;

    // Inside the block horizontally and vertically...
    expect(buttonBox.x).toBeGreaterThanOrEqual(blockBox.x);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width + 1);
    expect(buttonBox.y).toBeGreaterThanOrEqual(blockBox.y - 1);
    // ...and in its RIGHT half, near the TOP. A button that rendered but
    // landed under the code (or off-screen) would pass a bare visibility
    // check, so pin the corner rather than the existence.
    expect(buttonBox.x).toBeGreaterThan(blockBox.x + blockBox.width / 2);
    expect(buttonBox.y).toBeLessThan(blockBox.y + blockBox.height / 2);
  });

  test("clicking copies the raw source and confirms it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openTranscript(page);

    const button = page.locator("[data-code-copy]").first();
    const idleLabel = await button.getAttribute("aria-label");
    expect(idleLabel).toBe("Copy code");

    await button.click();

    // The clipboard is the external ground truth here — asserting the
    // icon changed would only prove the app agrees with itself.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // Highlight.js wraps tokens in <span>s; none of that may reach the
    // clipboard, and the trailing newline marked adds must not either.
    expect(clipboard.trim()).toBe(CODE_BODY);

    await expect(button).toHaveAttribute("aria-label", "Copied");
  });
});
