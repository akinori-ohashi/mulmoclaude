// The session model picker (#3147), and the two ways it stopped working
// during the #3148 cross-review.
//
// `makeSessionEntries` deliberately reports no `resolvedModel` and no
// `chatModel`, which is the state a real conversation is in until its first
// turn comes back — and the moment a per-chat model is most worth choosing.
// The chip used to hide itself in exactly that state, because it inherited a
// visibility rule written when it was a read-only label (#2554).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A } from "../fixtures/sessions";

const CHAT_MODEL_PATH = `/api/sessions/${SESSION_A.id}/chat-model`;
const chip = (page: Page) => page.getByTestId("session-model-chip");

test.describe("session model chip", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("offers the picker before the session has ever reported a model", async ({ page }) => {
    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(chip(page)).toBeVisible();
    // Every alias is selectable, plus the leading "no override" row.
    await expect(chip(page).locator("option")).toHaveCount(5);
    await expect(chip(page).locator("option").nth(1)).toHaveText("fable");
  });

  test("persists a chosen alias and then clears it", async ({ page }) => {
    const bodies: unknown[] = [];
    await page.route(`**${CHAT_MODEL_PATH}`, (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto(`/chat/${SESSION_A.id}`);

    await chip(page).selectOption("opus");
    await expect.poll(() => bodies).toEqual([{ chatModel: "opus" }]);

    // The clear button only exists while an override is set — it is the one
    // affordance that says "this chat is off the default".
    const clear = page.getByTestId("session-model-chip-clear");
    await expect(clear).toBeVisible();
    await clear.click();
    await expect.poll(() => bodies).toEqual([{ chatModel: "opus" }, { chatModel: null }]);
    await expect(clear).toBeHidden();
  });

  // The next turn reads the override from disk, so a send issued straight
  // after a selection must not overtake the write that persists it.
  test("does not dispatch a turn before the override write lands", async ({ page }) => {
    const order: string[] = [];
    await page.route(`**${CHAT_MODEL_PATH}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      order.push("chat-model");
      return route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/agent", (route) => {
      order.push("agent");
      return route.fulfill({ status: 202, json: { chatSessionId: SESSION_A.id } });
    });
    await page.goto(`/chat/${SESSION_A.id}`);

    await chip(page).selectOption("opus");
    await page.getByTestId("user-input").fill("hello");
    await page.getByTestId("send-btn").click();

    // Wait for both requests, then assert which one went first — a poll on the
    // order alone would go green the instant the array happened to match.
    await expect.poll(() => order.length, { timeout: 10_000 }).toBe(2);
    expect(order).toEqual(["chat-model", "agent"]);
  });
});
