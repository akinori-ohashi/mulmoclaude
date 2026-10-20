import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// A presentChart document whose charts need what ECharts does not carry: a bundled map with
// Japanese names and an echarts-gl 3D scatter. Each is loaded only because a chart uses it; the
// View must draw both without a problem on either card.

const CHARTS = [
  {
    title: "Prefectures",
    option: {
      visualMap: { min: 0, max: 100, show: false },
      series: [
        {
          type: "map",
          map: "japan-ja",
          data: [
            { name: "東京都", value: 90 },
            { name: "大阪府", value: 60 },
          ],
        },
      ],
    },
  },
  {
    title: "Points in 3D",
    option: {
      grid3D: {},
      xAxis3D: {},
      yAxis3D: {},
      zAxis3D: {},
      series: [
        {
          type: "scatter3D",
          data: [
            [1, 2, 3],
            [3, 1, 2],
          ],
        },
      ],
    },
  },
];

async function setupSession(page: Page) {
  await mockAllApis(page, {
    sessions: [{ id: "ext-session", title: "Extensions", roleId: "general", startedAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:05:00Z" }],
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: "ext-session" },
          { type: "text", source: "user", message: "Chart this" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "result-ext-1",
              toolName: "presentChart",
              message: "Chart ready",
              title: "Extensions",
              data: { title: "Extensions", filePath: "charts/extensions.chart.json", document: { title: "Extensions", columns: 2, charts: CHARTS } },
            },
          },
        ],
      }),
  );
}

test("draws a bundled map and a 3D scatter, loading each on demand", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setupSession(page);
  await page.goto("/chat/ext-session");
  await page.getByText("Extensions").first().click();
  for (const index of [0, 1]) {
    await expect(page.getByTestId(`chart-canvas-${index}`).locator("canvas").first()).toBeVisible();
    await expect(page.getByTestId(`chart-draw-problem-${index}`)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await expect(page.getByTestId("chart-export-svg-0")).toBeVisible();
  await expect(page.getByTestId("chart-export-svg-1")).toHaveCount(0);
});
