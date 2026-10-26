import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// A word cloud is drawn by @modernized/echarts-wordcloud, loaded only when a chart has one. If it
// were not loaded, ECharts would drop the series and the card would say "Unknown series type".

const WORDS = [
  "revenue",
  "売上",
  "customers",
  "churn",
  "東京都",
  "growth",
  "marketing",
  "WWWWWW",
  "margin",
  "在庫",
  "forecast",
  "region",
  "MMMM",
  "price",
  "retention",
  "大阪府",
  "campaign",
  "conversion",
  "支出",
  "quality",
  "supply",
  "demand",
  "利益率",
  "inventory",
  "segment",
  "cohort",
  "lifetime",
  "acquisition",
  "北海道",
  "pipeline",
].map((name, index) => ({ name, value: 100 - index * 3 }));

async function setupSession(page: Page) {
  await mockAllApis(page, {
    sessions: [{ id: "cloud-session", title: "Words", roleId: "general", startedAt: "2026-10-21T10:00:00Z", updatedAt: "2026-10-21T10:05:00Z" }],
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: "cloud-session" },
          { type: "text", source: "user", message: "Chart the words" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "result-cloud-1",
              toolName: "presentChart",
              message: "Chart ready",
              title: "Words",
              data: {
                title: "Words",
                filePath: "charts/words.chart.json",
                document: { title: "Words", charts: [{ title: "Topics", option: { tooltip: {}, series: [{ type: "wordCloud", data: WORDS }] } }] },
              },
            },
          },
        ],
      }),
  );
}

// The extension places words on timers after setOption, so wait for the canvas to fill.
const PAINTED_PIXELS_MIN = 2_000;

test("draws a word cloud with the extension, with no draw problem and no SVG export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setupSession(page);
  await page.goto("/chat/cloud-session");
  await page.getByText("Words").first().click();
  const canvas = page.getByTestId("chart-canvas-0").locator("canvas").first();
  await expect(canvas).toBeVisible();

  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) return 0;
        const context = element.getContext("2d");
        if (!context) return 0;
        const { data } = context.getImageData(0, 0, element.width, element.height);
        return data.filter((_value, index) => index % 4 === 3 && data[index] !== 0).length;
      }),
    )
    .toBeGreaterThan(PAINTED_PIXELS_MIN);

  await expect(page.getByTestId("chart-draw-problem-0")).toHaveCount(0);
  await expect(page.getByTestId("chart-export-svg-0")).toHaveCount(0);
  await expect(page.getByTestId("chart-export-png-0")).toBeVisible();
  expect(errors).toEqual([]);
});
