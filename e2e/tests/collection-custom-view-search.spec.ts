import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// The standard table's search box drives a custom view too (#2959): the host
// relays what the user types into the sandboxed iframe, where the injected
// `__MC_VIEW.searchQuery` / `.onSearchQueryChange(cb)` bridge exposes it. This
// exercises the whole chain in a real browser — watcher → postMessage → the
// bootstrap's listener → the view's own DOM.

const SEARCH_VIEW = { id: "search", label: "Search", file: "views/search.html", capabilities: ["read"] };

const DETAIL = {
  collection: {
    slug: "news",
    title: "News",
    icon: "rss_feed",
    source: "feed",
    schema: {
      title: "News",
      icon: "rss_feed",
      dataPath: "data/feeds/news",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
      views: [SEARCH_VIEW],
    },
  },
  items: [{ id: "a" }, { id: "b" }],
};

// Renders whatever the host relays, and counts callbacks so the debounce is
// observable (a per-keystroke relay would push the count past 1). `#go`
// navigates the frame away — a custom view is allowed to do that, and the
// search relay must not follow it (see the navigation test below).
const VIEW_HTML = `<!doctype html><html><head></head><body>
<div id="marker">view</div>
<div id="gen"></div>
<div id="conn"></div>
<div id="caught"></div>
<div id="query">unset</div>
<div id="calls">0</div>
<button id="go" type="button">leave</button>
<button id="again" type="button">reload</button>
<button id="open" type="button">open</button>
<button id="grab" type="button">leave and grab</button>
<script>
  var view = window.__MC_VIEW;
  var calls = 0;
  // Fresh per document, so a test can tell one generation of this frame from
  // the next — the marker text alone is identical across a reload.
  document.getElementById('gen').textContent = String(Math.random());
  // "connected" appears only once the host hands THIS document the search
  // channel and seeds it — the signal that a reinstall completed.
  window.addEventListener('message', function (event) {
    document.getElementById('caught').textContent += JSON.stringify(event.data) + ';';
  });
  function paint(query) {
    document.getElementById('query').textContent = query ? query : '(empty)';
  }
  paint(view.searchQuery);
  view.onSearchQueryChange(function (query) {
    calls++;
    document.getElementById('calls').textContent = String(calls);
    document.getElementById('conn').textContent = 'connected';
    paint(query);
  });
  document.getElementById('again').addEventListener('click', function () {
    location.reload();
  });
  document.getElementById('open').addEventListener('click', function () {
    view.openItem('a');
  });
  // A hostile view would hand everything it holds to the page it navigates to.
  // Nothing the host injects can survive that, which is why the host reinstalls
  // the view on a re-claim instead of trusting a secret.
  function leave(claim) {
    location.href = '/e2e-elsewhere.html?claim=' + claim + '#' + encodeURIComponent(JSON.stringify(view));
  }
  document.getElementById('go').addEventListener('click', function () { leave('0'); });
  document.getElementById('grab').addEventListener('click', function () { leave('1'); });
</script>
</body></html>`;

// Stands in for whatever a navigated-away view lands on. It APPENDS every
// message it catches — accumulating, not replacing, so a leak stays visible
// even after a later message arrives.
const ELSEWHERE_HTML = `<!doctype html><html><head></head><body>
<div id="marker">elsewhere</div>
<div id="caught"></div>
<script>
  window.addEventListener('message', function (event) {
    document.getElementById('caught').textContent += JSON.stringify(event.data) + ';';
  });
  // With ?claim=1, actively try to take the search channel over — replaying
  // everything the departing view leaked in the fragment, so the claim carries
  // real injected values rather than guesses.
  function claimChannel() {
    var channel = new MessageChannel();
    channel.port1.onmessage = function (event) {
      document.getElementById('caught').textContent += JSON.stringify(event.data) + ';';
    };
    var stolen = {};
    try { stolen = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch (error) { stolen = {}; }
    var claim = { type: 'mc-view-ready', slug: 'news' };
    Object.keys(stolen).forEach(function (key) { claim[key] = stolen[key]; });
    parent.postMessage(claim, '*', [channel.port2]);
  }
  if (location.search.indexOf('claim=1') !== -1) claimChannel();
</script>
</body></html>`;

// Posted into the frame AFTER the search text would have been relayed. Messages
// to one window are delivered in order, so once the probe shows up, anything
// the host sent earlier has shown up too — which turns "nothing leaked" into a
// synchronisation on an observable condition instead of a blind wait.
const PROBE = "probe-after-search";

async function postProbe(page: Page) {
  await page.evaluate((probe) => {
    const frame = document.querySelector('[data-testid="collection-custom-view-iframe"]');
    if (frame instanceof HTMLIFrameElement) frame.contentWindow?.postMessage({ probe }, "*");
  }, PROBE);
}

async function setup(page: Page) {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/news",
    (route) => route.fulfill({ json: DETAIL }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/news/view-token",
    (route) => route.fulfill({ json: { token: "tok-123", exp: Date.now() + 3_600_000, dataUrl: "/api/collections/news/view-data", capabilities: ["read"] } }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/news/view-file",
    (route) => route.fulfill({ contentType: "text/html", body: VIEW_HTML }),
  );
  await page.route(
    (url) => url.pathname === "/e2e-elsewhere.html",
    (route) => route.fulfill({ contentType: "text/html", body: ELSEWHERE_HTML }),
  );
}

const viewFrame = (page: Page) => page.frameLocator('[data-testid="collection-custom-view-iframe"]');

test.describe("standard search box → custom view", () => {
  test("relays what the user types, and the cleared box after it", async ({ page }) => {
    await setup(page);
    await page.goto("/collections/news");
    await page.getByTestId("collection-view-custom-search").click();
    await expect(page.getByTestId("collection-custom-view-iframe")).toBeVisible();
    await expect(viewFrame(page).locator("#query")).toHaveText("(empty)");

    await page.getByPlaceholder("Search records…").fill("kafka");
    await expect(viewFrame(page).locator("#query")).toHaveText("kafka");
    // One callback for the settled value — not one per character of "kafka".
    await expect(viewFrame(page).locator("#calls")).toHaveText("1");

    await page.getByPlaceholder("Search records…").fill("");
    await expect(viewFrame(page).locator("#query")).toHaveText("(empty)");
  });

  test("seeds a view opened after the query was already typed", async ({ page }) => {
    await setup(page);
    await page.goto("/collections/news");
    // Type in the table view first — no iframe exists to receive the message,
    // so the relay has to happen when the frame loads.
    await page.getByPlaceholder("Search records…").fill("kafka");
    await page.getByTestId("collection-view-custom-search").click();
    await expect(viewFrame(page).locator("#query")).toHaveText("kafka");
  });

  test("stops relaying once the view navigates its own frame away", async ({ page }) => {
    // A custom view may navigate itself — nothing in the sandbox or the CSP
    // prevents `location = …`. The user's typed text must not follow it into
    // whatever document lands there (#2963 review: Codex + CodeRabbit).
    await setup(page);
    await page.goto("/collections/news");
    await page.getByTestId("collection-view-custom-search").click();
    await page.getByPlaceholder("Search records…").fill("alpha");
    await expect(viewFrame(page).locator("#query")).toHaveText("alpha");

    await viewFrame(page).locator("#go").click();
    await expect(viewFrame(page).locator("#marker")).toHaveText("elsewhere");

    // Type again. The replacement document must never see it.
    await page.getByPlaceholder("Search records…").fill("secret-term");
    await expect(page.getByPlaceholder("Search records…")).toHaveValue("secret-term");

    await postProbe(page);
    // The probe arrived, so any earlier relay would have arrived before it.
    await expect(viewFrame(page).locator("#caught")).toContainText(PROBE);
    await expect(viewFrame(page).locator("#caught")).not.toContainText("secret-term");
  });

  test("evicts a page that tries to claim the channel, restoring the real view", async ({ page }) => {
    // A second claim means the document changed underneath the host, and no
    // injected secret can prove which document it is — the view can hand
    // anything it holds to the page it navigates to (codex, iteration 3). So
    // the host reinstalls the view it controls instead of choosing.
    await setup(page);
    await page.goto("/collections/news");
    await page.getByTestId("collection-view-custom-search").click();
    await page.getByPlaceholder("Search records…").fill("alpha");
    await expect(viewFrame(page).locator("#query")).toHaveText("alpha");

    await viewFrame(page).locator("#grab").click();

    // The claimant is gone; the real view is back and still driven by the box.
    await expect(viewFrame(page).locator("#query")).toHaveText("alpha");
    await page.getByPlaceholder("Search records…").fill("gamma");
    await expect(viewFrame(page).locator("#query")).toHaveText("gamma");
  });

  test("reconnects when the view reloads itself", async ({ page }) => {
    // The flip side of the navigation guard: a view that reloads ITSELF runs the
    // same injected bootstrap again, so it must get a working channel back
    // rather than going silently deaf (#2963 review, codex iteration 2).
    await setup(page);
    await page.goto("/collections/news");
    await page.getByTestId("collection-view-custom-search").click();
    await page.getByPlaceholder("Search records…").fill("alpha");
    await expect(viewFrame(page).locator("#query")).toHaveText("alpha");

    await viewFrame(page).locator("#again").click();
    // Wait for the reinstalled document to be handed the channel — `#marker`
    // is identical across a reload, so asserting on it would race.
    await expect(viewFrame(page).locator("#conn")).toHaveText("connected");
    // The host reinstalls the view and seeds the fresh frame with the live
    // query, so "alpha" comes back on its own (CodeRabbit: assert the reseed
    // rather than an empty state that could pass before the port connects).
    await expect(viewFrame(page).locator("#query")).toHaveText("alpha");

    // …and the host's search box still drives it.
    await page.getByPlaceholder("Search records…").fill("beta");
    await expect(viewFrame(page).locator("#query")).toHaveText("beta");
  });

  test("still routes openItem after the search branch joined the dispatcher", async ({ page }) => {
    // The view→host message dispatcher gained an `mc-view-ready` branch and was
    // narrowed once instead of per field. `openItem` shares that dispatcher, so
    // drive it for real rather than reasoning that it is unaffected.
    await setup(page);
    await page.goto("/collections/news");
    await page.getByTestId("collection-view-custom-search").click();
    await viewFrame(page).locator("#open").click();
    await expect(page.getByTestId("collections-record-modal")).toBeVisible();
  });

  test("hides the host's match count while a custom view is active", async ({ page }) => {
    await setup(page);
    await page.goto("/collections/news");
    // The count describes the host's own field matching, which a custom view
    // does not share — so it may only appear on the built-in views.
    await expect(page.getByText("Showing 2 of 2")).toBeVisible();
    await page.getByTestId("collection-view-custom-search").click();
    await expect(page.getByText(/Showing \d+ of \d+/)).toHaveCount(0);
    await page.getByTestId("collection-view-toggle-table").click();
    await expect(page.getByText("Showing 2 of 2")).toBeVisible();
  });
});
