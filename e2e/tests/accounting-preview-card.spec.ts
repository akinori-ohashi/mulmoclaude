// The sidebar preview card for accounting, on screen.
//
// #2716: the card had never rendered a real summary. `Preview.vue` declared
// `data` / `jsonData`; `SessionSidebar.vue` passes only `:result`, so both were
// always undefined and every action fell through to the generic line. The props
// of a dynamic `<component :is>` are not typechecked, so no gate saw it — and
// the unit tests exercised the summariser directly, never the wiring.
//
// These assert the rendered text, which is the only place the wiring shows.
//
// Every case here carries `data`, because that is the only way a result reaches
// the sidebar: the MCP bridge posts to the session only when the handler set it
// (`server/agent/mcp-server.ts`). Injecting a data-less envelope would render a
// card, but no live path produces one.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SESSION_ID = "accounting-preview-card-session";
const BOOK_ID = "book-preview-card";

/** A `manageAccounting` tool_result as the router now builds it: the payload
 *  mirrored into `data`, which is what the card summarises. */
const accountingResult = (uuid: string, data: Record<string, unknown>) => ({
  type: "tool_result",
  source: "tool",
  result: { uuid, toolName: "manageAccounting", message: "Accounting", data },
});

async function openSessionWith(page: Page, results: Record<string, unknown>[]): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Accounting Preview Card",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [{ type: "session_meta", roleId: "general", sessionId: SESSION_ID }, { type: "text", source: "user", message: "Show me the books" }, ...results],
      }),
  );

  await page.goto(`/chat/${SESSION_ID}`);
  await expect(page.getByTestId("tool-results-scroll")).toBeVisible();
}

test.describe("accounting sidebar preview card", () => {
  test("createBook names the book instead of the generic line", async ({ page }) => {
    await openSessionWith(page, [accountingResult("acct-create", { action: "createBook", book: { id: BOOK_ID, name: "Preview Co" } })]);

    const card = page.getByTestId("accounting-preview");
    await expect(card).toBeVisible();
    await expect(card).toContainText('Created book "Preview Co"');
    // The string the card showed for every action before #2716 was fixed.
    await expect(card).not.toContainText("Accounting result");
  });

  test("addEntries names the date it posted", async ({ page }) => {
    await openSessionWith(page, [accountingResult("acct-entry", { action: "addEntries", bookId: BOOK_ID, entries: [{ id: "e1", date: "2026-02-01" }] })]);

    await expect(page.getByTestId("accounting-preview")).toContainText("Posted entry on 2026-02-01");
  });

  test("an unrecognised payload falls back to the generic line", async ({ page }) => {
    // With `data` PRESENT — which is the only way a result reaches the sidebar.
    // The MCP bridge posts to the session solely when the handler set `data`
    // (`server/agent/mcp-server.ts`), so a card with no payload at all is not a
    // state the live path can produce, and asserting one would be theatre.
    await openSessionWith(page, [accountingResult("acct-unknown", { action: "somethingNew", bookId: BOOK_ID })]);

    await expect(page.getByTestId("accounting-preview")).toContainText(`Accounting · ${BOOK_ID}`);
  });
});
