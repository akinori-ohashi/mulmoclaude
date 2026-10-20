import { test, expect, type Download, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// A word cloud is laid out by the plugin with estimated text widths. This draws one in Chromium
// and checks the estimate against the browser: the exported SVG, laid out with the browser's own
// fonts, must have no two words over each other.

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

async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("draws a word cloud whose words do not overlap in the browser's own fonts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setupSession(page);
  await page.goto("/chat/cloud-session");
  await page.getByText("Words").first().click();
  await expect(page.getByTestId("chart-canvas-0").locator("canvas").first()).toBeVisible();
  await expect(page.getByTestId("chart-draw-problem-0")).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByTestId("chart-export-svg-0").click();
  const svg = await readDownload(await download);

  const measured = await page.evaluate((markup) => {
    const holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "0";
    holder.style.top = "0";
    document.body.appendChild(holder);
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    holder.appendChild(document.importNode(parsed, true));
    const frame = holder.getBoundingClientRect();
    const words = [...holder.querySelectorAll("text")].map((text) => {
      const box = text.getBoundingClientRect();
      return { text: text.textContent ?? "", left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    });
    holder.remove();
    return { words, width: frame.width, height: frame.height };
  }, svg);

  expect(errors).toEqual([]);
  expect(measured.words.length).toBeGreaterThan(WORDS.length / 2);
  // Glyph boxes include the font's line gap, so neighbours may touch by a pixel without overlapping ink.
  const TOUCH_PX = 1;
  const overlapping = measured.words.flatMap((first, i) =>
    measured.words
      .slice(i + 1)
      .filter(
        (second) =>
          first.left < second.right - TOUCH_PX &&
          second.left < first.right - TOUCH_PX &&
          first.top < second.bottom - TOUCH_PX &&
          second.top < first.bottom - TOUCH_PX,
      )
      .map((second) => `${first.text} / ${second.text}`),
  );
  expect(overlapping).toEqual([]);
  measured.words.forEach((word) => {
    expect(word.left).toBeGreaterThanOrEqual(-TOUCH_PX);
    expect(word.right).toBeLessThanOrEqual(measured.width + TOUCH_PX);
  });
});
