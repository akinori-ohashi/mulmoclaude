import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import {
  assertMovieErrorChip,
  assertScriptHeader,
  mockGenerateMovieError,
  mockRenderBeatError,
  mockRenderBeatSuccess,
  MULMO_DISPATCH_PATH,
  openMulmoSessionAndSelectScript,
  waitForRenderedBeatImage,
} from "../fixtures/present-mulmo-script";

const SCRIPT_TITLE = "Test Mulmo Script";
const SCRIPT_DESCRIPTION = "A short test script used by the smoke test.";
const SESSION_PATH = "/chat/mulmo-session";

// 1×1 transparent PNG. Used by the render-beat success mock.
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";
// Prefix the View's <img src> ends up with after the success mock fires.
const PNG_DATA_URI_PREFIX = "data:image/png;base64,iVBOR";
// The per-beat button label (mulmoscript-plugin `m.generate`, English locale).
const GENERATE_LABEL = "Generate";

const SAMPLE_SCRIPT = {
  $mulmocast: { version: "1.1" },
  title: SCRIPT_TITLE,
  description: SCRIPT_DESCRIPTION,
  lang: "en",
  beats: [
    {
      speaker: "Narrator",
      text: "Beat one narration.",
      image: {
        type: "textSlide",
        slide: { title: "Slide 1", bullets: ["one"] },
      },
    },
    {
      speaker: "Narrator",
      text: "Beat two narration.",
      imagePrompt: "Something visual",
    },
  ],
  imageParams: {},
};

async function setupScriptSession(page: Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: "mulmo-session",
        title: "Mulmo Session",
        roleId: "general",
        startedAt: "2026-04-12T10:00:00Z",
        updatedAt: "2026-04-12T10:05:00Z",
      },
    ],
  });

  // Session transcript with a presentMulmoScript tool result.
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          {
            type: "session_meta",
            roleId: "general",
            sessionId: "mulmo-session",
          },
          { type: "text", source: "user", message: "Make me a slideshow" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "mulmo-result-1",
              toolName: "presentMulmoScript",
              title: SCRIPT_TITLE,
              message: "Script saved",
              data: {
                script: SAMPLE_SCRIPT,
                filePath: "scripts/test-mulmo-script.json",
              },
            },
          },
        ],
      }),
  );

  // Stub the mulmoScript dispatch URL the View drives on mount
  // (save-refresh, beat probes, statuses, pendingGenerations). Every
  // probe tolerates a non-ok envelope silently, so an empty JSON body
  // (which the transport treats as a failure envelope) is enough to
  // keep the UI stable. Per-test kind mocks register later and take
  // precedence (Playwright routes are LIFO), falling back here for
  // kinds they don't own.
  await page.route(
    (url) => url.pathname === MULMO_DISPATCH_PATH,
    (route) => route.fulfill({ json: {} }),
  );
}

/**
 * Override the session-list endpoint so mulmo-session reports
 * isRunning=true. setupScriptSession (in beforeEach) already mocks
 * everything else; calling mockAllApis again would clobber the script
 * transcript route. Playwright routes are LIFO, so this added handler
 * takes precedence.
 */
async function stubRunningSession(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/sessions",
    (route) =>
      route.fulfill({
        json: {
          sessions: [
            {
              id: "mulmo-session",
              title: "Mulmo Session",
              roleId: "general",
              startedAt: "2026-04-12T10:00:00Z",
              updatedAt: "2026-04-12T10:05:00Z",
              isRunning: true,
            },
          ],
          cursor: "v1:0",
          deletedIds: [],
        },
      }),
  );
}

test.describe("presentMulmoScript plugin", () => {
  test.beforeEach(async ({ page }) => {
    await setupScriptSession(page);
  });

  test("Preview shows the script title in the sidebar", async ({ page }) => {
    await page.goto(SESSION_PATH);
    await expect(page.getByTestId("app-title")).toBeVisible();
    await expect(page.getByTestId("mulmo-script-preview-title").first()).toHaveText(SCRIPT_TITLE);
  });

  test("View renders script title, description and beat count when selected", async ({ page }) => {
    await openMulmoSessionAndSelectScript(page, SESSION_PATH);
    await assertScriptHeader(page, SCRIPT_TITLE);
    await expect(page.getByTestId("mulmo-script-description")).toHaveText(SCRIPT_DESCRIPTION);
    await expect(page.getByText("2 beats")).toBeVisible();
  });

  test("View does not crash when the mulmo-script API endpoints return empty", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await openMulmoSessionAndSelectScript(page, SESSION_PATH);
    // assertScriptHeader waits for the View to mount and render its header,
    // by which point any mount-time page error would have been captured.
    await assertScriptHeader(page, SCRIPT_TITLE);
    expect(errors).toEqual([]);
  });

  // Every op resolves through the dispatch envelope — `{ ok: false,
  // error }` on failure, `{ ok: true, image: "data:..." }` on success.
  // The View reads exactly those shapes, so the frontend wiring is the
  // regression net for the extraction.

  // Beat 0 (textSlide) is drawn in the browser by beatToHtml (#3472); beat 1 (imagePrompt) still goes through the
  // server's `renderBeat`, which the user starts with the Generate button.
  test("textSlide beat is drawn as HTML in a sandboxed iframe, without a renderBeat call (#3472)", async ({ page }) => {
    const getRenderBeatCalls = await mockRenderBeatSuccess(page, PNG_1X1);
    await openMulmoSessionAndSelectScript(page, SESSION_PATH);
    await assertScriptHeader(page, SCRIPT_TITLE);
    const frame = page.getByTestId("mulmo-script-beat-html-0");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    await expect(page.frameLocator('[data-testid="mulmo-script-beat-html-0"]').getByText("Slide 1")).toBeVisible();
    const calls = getRenderBeatCalls();
    expect(calls.filter((call) => (call as { beatIndex?: number }).beatIndex === 0)).toHaveLength(0);
  });

  test("render-beat success: mocked image surfaces in the View", async ({ page }) => {
    // Generating beat 1 proves the server→frontend contract (`{ ok: true, image: <data-uri> }`) still holds.
    const getRenderBeatCalls = await mockRenderBeatSuccess(page, PNG_1X1);
    await openMulmoSessionAndSelectScript(page, SESSION_PATH);
    await assertScriptHeader(page, SCRIPT_TITLE);
    await page.getByRole("button", { name: GENERATE_LABEL, exact: true }).first().click();
    await waitForRenderedBeatImage(page, PNG_DATA_URI_PREFIX);

    const calls = getRenderBeatCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatchObject({ filePath: expect.any(String), beatIndex: expect.any(Number) });
    }
  });

  test("render-beat error: mocked { error } surfaces to the UI", async ({ page }) => {
    // Generating beat 1 resolves to { ok: false, error }; the View shows the error string in the placeholder slot.
    await mockRenderBeatError(page, "Image was not generated");
    await openMulmoSessionAndSelectScript(page, SESSION_PATH);
    await assertScriptHeader(page, SCRIPT_TITLE);
    await page.getByRole("button", { name: GENERATE_LABEL, exact: true }).first().click();
    await expect(page.getByText("Image was not generated")).toBeVisible();
  });

  // E2E for the update-beat save-failure UX is covered manually —
  // see docs/manual-testing.md. It kept flaking when run in the full
  // suite (the Update button fetch was occasionally never seen by the
  // per-test mock even though it passed in isolation), so the check
  // lives in manual testing rather than gating CI.

  // Regression for #1197. Movie generation used to surface errors via
  // `alert()` — blocking, no retry, and once dismissed the canvas
  // looked identical to a healthy idle state. The fix swaps to an
  // inline error chip + Retry button between the chrome row and the
  // Characters section. This test pins both the chip surface and the
  // retry round-trip.
  test("generateMovie error: failure envelope surfaces inline chip + retry button re-fires the request", async ({ page }) => {
    const SSE_ERROR_MESSAGE = "Page.captureScreenshot timed out.";
    const getGenerateMovieCalls = await mockGenerateMovieError(page, SSE_ERROR_MESSAGE);

    await openMulmoSessionAndSelectScript(page, SESSION_PATH);
    await assertScriptHeader(page, SCRIPT_TITLE);

    // First attempt: chip should appear with the server-supplied
    // message. expect.poll instead of plain equality tolerates the
    // microtask gap between the route handler firing and the SPA's
    // failure arm landing.
    await page.getByTestId("mulmo-script-generate-movie-button").click();
    const errorChip = await assertMovieErrorChip(page, SSE_ERROR_MESSAGE);
    // The linter's assertion detector doesn't pick up `expect.poll`
    // as an assertion (looks for `expect(x).to*` chains). Add an
    // explicit expect on the returned Locator; `assertMovieErrorChip`
    // guarantees it's visible so this is a documented no-op.
    await expect(errorChip).toBeVisible();
    await expect.poll(getGenerateMovieCalls).toBe(1);

    // Retry: same endpoint is hit again, chip stays (same error replays).
    await errorChip.getByTestId("mulmo-script-movie-retry-button").click();
    await assertMovieErrorChip(page, SSE_ERROR_MESSAGE);
    await expect.poll(getGenerateMovieCalls).toBe(2);
  });

  // Regression for #839 + the in-PR follow-up. The slide view must
  // light up the shared ThinkingIndicator while the active session
  // has a chat turn in flight — same signal the chat sidebar uses,
  // not just the slide-local generation flags.
  test("ThinkingIndicator lights up when the active session is running", async ({ page }) => {
    await stubRunningSession(page);
    await openMulmoSessionAndSelectScript(page, SESSION_PATH);
    await assertScriptHeader(page, SCRIPT_TITLE);

    // The indicator lives in the chat sidebar (above ChatInput), not
    // inside the slide view itself — App.vue is now the canonical
    // mount slot. Two complementary assertions:
    //   1. Page-wide count == 1 catches duplicate role=status
    //      regions reappearing anywhere in the DOM.
    //   2. The sidebar-scoped lookup pins the canonical mount slot so
    //      a stray copy outside the sidebar would still fail count.
    await expect(page.getByTestId("thinking-indicator")).toHaveCount(1);
    const sidebarIndicator = page.getByTestId("chat-sidebar").getByTestId("thinking-indicator");
    await expect(sidebarIndicator).toBeVisible();
    await expect(sidebarIndicator).toContainText("Thinking");
  });
});
