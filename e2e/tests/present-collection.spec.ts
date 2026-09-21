import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Throwaway reproduction spec for the presentCollection render crash.
// Captures the FIRST thrown exception (page.on("pageerror")) which the
// browser console only showed as downstream null-component fallout.
//
// Shared localStorage state-store coverage (sort + view mode read by
// both the standalone route AND the embedded card) lives in
// collection-state-persist.spec.ts. This file only covers crash
// regressions and the in-modal edit/add flows that are specific to
// the presentCollection card surface.

const SESSION_PATH = "/chat/watchlist-session";

const WATCHLIST_DETAIL = {
  collection: {
    slug: "watchlist",
    title: "Watchlist",
    icon: "movie",
    source: "user",
    schema: {
      title: "Watchlist",
      icon: "movie",
      dataPath: "data/watchlist/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true },
        title: { type: "string", label: "Title", required: true },
        type: { type: "string", label: "Type" },
        mainActor: { type: "string", label: "Main Actor" },
        genre: { type: "string", label: "Genre" },
        platform: { type: "string", label: "Platform" },
        synopsis: { type: "markdown", label: "Synopsis" },
        watched: { type: "boolean", label: "Watched" },
      },
    },
  },
  items: [
    { id: "avatar", title: "アバター", type: "映画", mainActor: "Sam Worthington", genre: "SF", platform: "Disney+", synopsis: "...", watched: false },
    { id: "jack-ryan", title: "Jack Ryan", type: "TV", genre: "Thriller", platform: "Prime", watched: true },
  ],
};

async function setup(page: Page) {
  await mockAllApis(page, {
    sessions: [{ id: "watchlist-session", title: "Watchlist", roleId: "general", startedAt: "2026-05-29T10:00:00Z", updatedAt: "2026-05-29T10:05:00Z" }],
  });

  await page.route(
    (url) => url.pathname === "/api/collections/watchlist",
    (route) => route.fulfill({ json: WATCHLIST_DETAIL }),
  );

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: "watchlist-session" },
          { type: "text", source: "user", message: "show me the watchlist" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "pc-result-1",
              toolName: "presentCollection",
              title: "Watchlist",
              message: "Presented collection watchlist / avatar",
              data: { collectionSlug: "watchlist", itemId: "avatar" },
            },
          },
        ],
      }),
  );
}

// Regression: the presentCollection card mounts the full CollectionView
// via `wrapWithScope`, whose setup calls `pluginEndpoints("presentCollection")`.
// That scope MUST be registered in the host endpoint registry
// (`src/main.ts`); otherwise setup throws, the component subtree is left
// null, and Vue's patch crashes with `emitsOptions`/`subTree` of null
// during the next <App> update. This asserts the card renders cleanly,
// the per-item detail modal opens (itemId in the tool result), and no
// uncaught page error fires.
test("presentCollection card renders the collection without crashing", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });
  // itemId "avatar" was passed → the read-only detail opens in the shared
  // record modal on mount.
  await expect(page.getByTestId("collections-record-modal")).toBeVisible();
  await expect(page.getByTestId("collections-detail")).toBeVisible();
  await expect(page.getByTestId("collections-detail-title")).toHaveText("avatar");

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

test("Edit on an open record swaps the modal to the edit form in place", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("collections-detail")).toBeVisible({ timeout: 10_000 });
  // Edit flips the SAME modal to the edit form in place — the layout doesn't
  // change, only the controls become editable.
  await page.getByTestId("collections-detail-edit").click();
  await expect(page.getByTestId("collections-record-modal")).toBeVisible();
  await expect(page.getByTestId("collections-edit")).toBeVisible();
  await expect(page.getByTestId("collections-detail")).toBeHidden();
  await expect(page.getByTestId("collections-input-title")).toHaveValue("アバター");

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

test("Add opens the create form in the shared record modal", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.goto(SESSION_PATH);
  await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });

  // The card mounts with itemId "avatar" → the detail modal is open. Close it
  // first so the (overlay-covered) Add button is clickable.
  await expect(page.getByTestId("collections-record-modal")).toBeVisible();
  await page.getByTestId("collections-detail-close").click();
  await expect(page.getByTestId("collections-record-modal")).toHaveCount(0);

  await page.getByTestId("collections-add-item").click();
  await expect(page.getByTestId("collections-record-modal")).toBeVisible();
  await expect(page.getByTestId("collections-create")).toBeVisible();

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

test("saving an edit returns to the record's detail (does not close) in the embedded card", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.route(
    (url) => url.pathname === "/api/collections/watchlist/items/avatar",
    (route) => (route.request().method() === "PUT" ? route.fulfill({ json: { itemId: "avatar", item: WATCHLIST_DETAIL.items[0] } }) : route.fallback()),
  );
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("collections-detail")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("collections-detail-edit").click();
  await expect(page.getByTestId("collections-edit")).toBeVisible();
  await page.getByTestId("collections-input-title").fill("アバター (改)");
  await page.getByTestId("collections-editor-save").click();

  // Back to the read-only detail of the same record — NOT closed.
  await expect(page.getByTestId("collections-detail")).toBeVisible();
  await expect(page.getByTestId("collections-detail-title")).toHaveText("avatar");
  await expect(page.getByTestId("collections-edit")).toBeHidden();

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

// The record's "chat about this record" box, on the card surface (#3220).
//
// The detail lives in a `fixed inset-0` overlay. Embedded, the chat it seeds is
// sent into the session ALREADY RUNNING and rendered behind that overlay, so
// leaving the modal up hid the very thing the button started — with an emptied
// textarea as the only sign anything had happened. This is the surface the bug
// was reported on, and the only one where a closed modal is this fix's doing:
// the standalone page navigates to /chat and the overlay goes with it either
// way (collection-chat-button.spec.ts covers that the seed survives the trip).
test("chatting about a record sends into the session AND dismisses the modal", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("collections-detail")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("collections-detail-chat-input").fill("  who else is in this?  ");

  const agentPost = page.waitForRequest((req) => req.url().endsWith("/api/agent") && req.method() === "POST");
  await page.getByTestId("collections-detail-chat-send").click();

  // Scoped to the open record: the `id=` selector is read off the record
  // BEFORE the modal closes, so closing must not cost the agent its subject.
  expect((await agentPost).postDataJSON().message).toBe("/watchlist id=avatar who else is in this?");

  // The overlay is gone, so the chat that just started is on screen.
  await expect(page.getByTestId("collections-record-modal")).toHaveCount(0);
  await expect(page.getByTestId("present-collection")).toBeVisible();

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

// The same send, but from inside the calendar day popup — the OTHER full-screen
// surface the record's detail can sit in (`CollectionDayView`, also
// `fixed inset-0`). Two things have to hold and only the card can show both:
// the popup goes down with the detail, and focus comes back to the day cell
// that opened it. The standalone page cannot assert the second, because
// `startChat` navigates to /chat and takes the cell with it; here the seed goes
// into the running session and nothing moves.
const DATED_DAY = (() => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
})();

const DATED_DETAIL = {
  collection: {
    slug: "dated-events",
    title: "Events",
    icon: "event",
    source: "user",
    schema: {
      title: "Events",
      icon: "event",
      dataPath: "data/dated-events/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        on: { type: "date", label: "Date" },
      },
      displayField: "name",
      calendarField: "on",
    },
  },
  items: [{ id: "launch", name: "Launch party", on: DATED_DAY }],
};

test("record chat from the card's day popup closes it and restores focus", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  // Open the card straight onto the calendar via the shared view-mode store,
  // so the test drives the day popup rather than the toolbar.
  await page.addInitScript(() => {
    localStorage.setItem("collection_view_modes", JSON.stringify({ "dated-events": "calendar" }));
  });
  await mockAllApis(page, {
    sessions: [{ id: "watchlist-session", title: "Events", roleId: "general", startedAt: "2026-05-29T10:00:00Z", updatedAt: "2026-05-29T10:05:00Z" }],
  });
  await page.route(
    (url) => url.pathname === "/api/collections/dated-events",
    (route) => route.fulfill({ json: DATED_DETAIL }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: "watchlist-session" },
          { type: "text", source: "user", message: "show me the events" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "pc-result-3",
              toolName: "presentCollection",
              title: "Events",
              message: "Presented collection dated-events",
              data: { collectionSlug: "dated-events" },
            },
          },
        ],
      }),
  );

  await page.goto(SESSION_PATH);
  await expect(page.getByTestId("collection-calendar")).toBeVisible({ timeout: 10_000 });

  const cell = page.getByTestId(`collection-calendar-day-${DATED_DAY}`);
  await cell.focus();
  await cell.press("Enter");
  await expect(page.getByTestId("collection-day-view")).toBeVisible();
  await page.getByTestId("collection-day-view-allday-launch").click();
  await expect(page.getByTestId("collections-detail")).toBeVisible();

  await page.getByTestId("collections-detail-chat-input").fill("who is coming?");
  const agentPost = page.waitForRequest((req) => req.url().endsWith("/api/agent") && req.method() === "POST");
  await page.getByTestId("collections-detail-chat-send").click();

  expect((await agentPost).postDataJSON().message).toBe("/dated-events id=launch who is coming?");
  await expect(page.getByTestId("collection-day-view")).toHaveCount(0);
  await expect(page.getByTestId("collections-detail")).toHaveCount(0);
  // The send removed the focused textarea. Without the restore, focus sits on
  // <body> and Tab restarts at the top of the document.
  await expect(cell).toBeFocused();

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

// ── Card viewState: the custom-view round trip (#3061) ────────────────
//
// The card persists its own view choice in the tool result's `viewState`
// (the shared localStorage store is standalone-authored; a card reads it
// but never writes it). That state used to be narrowed to the three
// built-ins on the way OUT, so picking a custom view wrote `"table"` and
// every remount dropped back to the table — and because `initialView`
// outranks the slug's stored preference, the card kept overwriting a
// custom view chosen on the standalone page too.
//
// Switching sessions and back is the reported repro: `loadSession`
// reuses an already-loaded session from `sessionMap`, so the card
// remounts against the SAME in-memory result and restores from its
// `viewState` exactly as it does after a Canvas re-render.

const OTHER_SESSION_ID = "other-session";

const WATCHLIST_WITH_VIEW = {
  ...WATCHLIST_DETAIL,
  collection: {
    ...WATCHLIST_DETAIL.collection,
    schema: {
      ...WATCHLIST_DETAIL.collection.schema,
      views: [{ id: "board", label: "Board", file: "views/board.html" }],
    },
  },
};

async function setupWithCustomView(page: Page) {
  await mockAllApis(page, {
    sessions: [
      { id: "watchlist-session", title: "Watchlist", roleId: "general", startedAt: "2026-05-29T10:00:00Z", updatedAt: "2026-05-29T10:05:00Z" },
      { id: OTHER_SESSION_ID, title: "Other", roleId: "general", startedAt: "2026-05-29T09:00:00Z", updatedAt: "2026-05-29T09:05:00Z" },
    ],
  });

  await page.route(
    (url) => url.pathname === "/api/collections/watchlist",
    (route) => route.fulfill({ json: WATCHLIST_WITH_VIEW }),
  );

  // The custom view's own load (token → html → i18n). The iframe content is
  // irrelevant here — what's under test is which view the card RESTORES — but
  // mocking them keeps the page free of uncaught errors.
  await page.route(
    (url) => url.pathname === "/api/collections/watchlist/view-token",
    (route) =>
      route.fulfill({
        json: { token: "view-token-1", exp: Date.now() + 60 * 60 * 1000, dataUrl: "/api/collections/watchlist/view-data", capabilities: ["read"] },
      }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/watchlist/view-file",
    (route) => route.fulfill({ contentType: "text/html", body: "<html><body><div id='board'>board view</div></body></html>" }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/watchlist/view-i18n",
    (route) => route.fulfill({ json: { locale: "", dict: {} } }),
  );

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) => {
      const isWatchlist = route.request().url().includes("watchlist-session");
      route.fulfill({
        json: isWatchlist
          ? [
              { type: "session_meta", roleId: "general", sessionId: "watchlist-session" },
              { type: "text", source: "user", message: "show me the watchlist" },
              {
                type: "tool_result",
                source: "tool",
                // No `viewState` — the card starts on the table, as a fresh card does.
                result: {
                  uuid: "pc-result-custom",
                  toolName: "presentCollection",
                  title: "Watchlist",
                  message: "Presented collection watchlist",
                  data: { collectionSlug: "watchlist" },
                },
              },
            ]
          : [
              { type: "session_meta", roleId: "general", sessionId: OTHER_SESSION_ID },
              { type: "text", source: "user", message: "something else" },
            ],
      });
    },
  );
}

/** Switch to the other session and back, via the session-history panel —
 *  an in-app navigation, so the card remounts against the same in-memory
 *  tool result rather than a fresh fetch. */
async function roundTripThroughOtherSession(page: Page) {
  const toggle = page.getByTestId("session-history-toggle-off");
  if (await toggle.isVisible()) await toggle.click();
  await page.getByTestId(`session-item-${OTHER_SESSION_ID}`).click();
  await page.waitForURL(new RegExp(OTHER_SESSION_ID));
  await expect(page.getByTestId("present-collection")).toHaveCount(0);

  const reopen = page.getByTestId("session-history-toggle-off");
  if (await reopen.isVisible()) await reopen.click();
  await page.getByTestId("session-item-watchlist-session").click();
  await page.waitForURL(/watchlist-session/);
}

test("a custom view picked in the card survives a session switch", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setupWithCustomView(page);
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });
  const boardToggle = page.getByTestId("collection-view-custom-board");
  await expect(boardToggle).toBeVisible();
  await expect(boardToggle).toHaveAttribute("aria-pressed", "false");

  await boardToggle.click();
  await expect(boardToggle).toHaveAttribute("aria-pressed", "true");

  await roundTripThroughOtherSession(page);

  await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });
  // The regression: this came back "false" (the table) because the emit
  // narrowed `custom:board` to `"table"` before the card could store it.
  await expect(page.getByTestId("collection-view-custom-board")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("collection-view-toggle-table")).toHaveAttribute("aria-pressed", "false");

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});
