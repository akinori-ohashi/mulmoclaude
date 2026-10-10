// After a server restart an open page holds a token the server no longer
// accepts (#3438). The page fetches index.html again — the server substitutes
// the current token into it on every request — installs the token it carries
// and goes on: the refused socket handshake reconnects with it, and a 401 on
// `/api/*` is retried with it. Only when index.html carries no usable token
// does the page fall back to a banner with a Reload button. E2E runs against
// `yarn dev:client` only: the socket is a Playwright mock speaking the
// socket.io wire protocol (`fixtures/pubsub.ts`), and the page's own re-fetch
// of `/` is answered with a rotated token in place of the one Vite injected.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { E2E_AUTH_TOKEN } from "../fixtures/authToken";
import {
  ENGINE_IO_OPEN_PACKET,
  parseConnectPacket,
  parseEventPacket,
  SOCKET_IO_CONNECT_ACK_PACKET,
  SOCKET_IO_CONNECT_REFUSED_PACKET,
} from "../fixtures/pubsub";

const ROTATED_TOKEN = "e2e-rotated-token";
const BANNER = "auth-token-stale-banner";
const RELOAD_BUTTON = "auth-token-stale-reload";

interface IndexHtmlLog {
  /** The page's own re-fetches of `/`. */
  refetches: number;
}

/** Answer the page's re-fetch of `/` with index.html carrying `token` in place
 *  of the one Vite injected. Navigations keep Vite's own answer, so the page
 *  always boots with `E2E_AUTH_TOKEN`. */
async function serveIndexHtmlWithToken(page: Page, token: string): Promise<IndexHtmlLog> {
  const indexHtmlLog: IndexHtmlLog = { refetches: 0 };
  await page.route(
    (url) => url.pathname === "/",
    async (route: Route) => {
      if (route.request().isNavigationRequest()) return route.fallback();
      indexHtmlLog.refetches += 1;
      const served = await route.fetch();
      const html = (await served.text()).replace(`content="${E2E_AUTH_TOKEN}"`, `content="${token}"`);
      return route.fulfill({ status: 200, contentType: "text/html", body: html });
    },
  );
  return indexHtmlLog;
}

interface SocketLog {
  /** `auth.token` of every CONNECT packet the page sent, in order. */
  tokens: (string | null)[];
  /** `subscribe` events the page sent: the client emits them only after it
   *  has processed a CONNECT ack. */
  subscribes: number;
}

/** Mock the pubsub socket: ack a CONNECT carrying `acceptedToken`, refuse any
 *  other, and record what the page sends. */
async function mockPubSubAccepting(page: Page, acceptedToken: string): Promise<SocketLog> {
  const socketLog: SocketLog = { tokens: [], subscribes: 0 };
  await page.routeWebSocket(
    (url) => url.pathname.startsWith("/ws/pubsub"),
    (webSocket) => {
      webSocket.send(ENGINE_IO_OPEN_PACKET);
      webSocket.onMessage((msg) => {
        const text = String(msg);
        const connect = parseConnectPacket(text);
        if (connect !== null) {
          socketLog.tokens.push(connect.token);
          webSocket.send(connect.token === acceptedToken ? SOCKET_IO_CONNECT_ACK_PACKET : SOCKET_IO_CONNECT_REFUSED_PACKET);
          return;
        }
        if (parseEventPacket(text)?.name === "subscribe") socketLog.subscribes += 1;
      });
    },
  );
  return socketLog;
}

/** `/api/health` answering 401 to every bearer but `acceptedToken` (`null`:
 *  to every bearer), recording each bearer it saw. Registered after
 *  `mockAllApis`, so it wins. */
async function mockHealthAccepting(page: Page, acceptedToken: string | null): Promise<string[]> {
  const bearers: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/health",
    (route: Route) => {
      const bearer = route.request().headers()["authorization"] ?? "";
      bearers.push(bearer);
      if (acceptedToken !== null && bearer === `Bearer ${acceptedToken}`) {
        return route.fulfill({ json: { geminiAvailable: true, sandboxEnabled: false } });
      }
      return route.fulfill({ status: 401, json: { error: "unauthorized" } });
    },
  );
  return bearers;
}

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test("a refused handshake reconnects with the token index.html now carries, and shows no banner", async ({ page }) => {
  const indexHtmlLog = await serveIndexHtmlWithToken(page, ROTATED_TOKEN);
  const socketLog = await mockPubSubAccepting(page, ROTATED_TOKEN);
  await page.goto("/");
  // The dev-plugin reload listener subscribes at boot, so the socket opens on
  // every page without any user action. Its first CONNECT carries the token
  // the page booted with and is refused; the second carries the rotated one.
  await expect.poll(() => socketLog.subscribes).toBeGreaterThan(0);
  expect(socketLog.tokens).toEqual([E2E_AUTH_TOKEN, ROTATED_TOKEN]);
  expect(indexHtmlLog.refetches).toBe(1);
  await expect(page.getByTestId(BANNER)).toHaveCount(0);
});

test("a 401 on /api/* is retried once with the token index.html now carries", async ({ page }) => {
  await serveIndexHtmlWithToken(page, ROTATED_TOKEN);
  await mockPubSubAccepting(page, ROTATED_TOKEN);
  const healthBearers = await mockHealthAccepting(page, ROTATED_TOKEN);
  await page.goto("/");
  // App.vue fetches /api/health at mount: the first call presents the boot
  // token and is refused, the retry presents the rotated one.
  await expect.poll(() => healthBearers.length).toBeGreaterThanOrEqual(2);
  expect(healthBearers.slice(0, 2)).toEqual([`Bearer ${E2E_AUTH_TOKEN}`, `Bearer ${ROTATED_TOKEN}`]);
  await expect(page.getByTestId(BANNER)).toHaveCount(0);
});

// The issue's own scenario: the page is open, the server has restarted, and
// the user sends a message. `POST /api/agent` goes through `apiFetchRaw`, not
// `apiCall`, so it has its own retry to prove. `/api/health` keeps accepting
// the boot token here, so the send is the first call the server refuses.
test("a send refused with the boot token is re-issued once with the token index.html now carries", async ({ page }) => {
  await serveIndexHtmlWithToken(page, ROTATED_TOKEN);
  await mockPubSubAccepting(page, E2E_AUTH_TOKEN);
  await mockHealthAccepting(page, E2E_AUTH_TOKEN);
  const agentBearers: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/agent",
    (route: Route) => {
      const bearer = route.request().headers()["authorization"] ?? "";
      agentBearers.push(bearer);
      if (bearer === `Bearer ${ROTATED_TOKEN}`) return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
      return route.fulfill({ status: 401, json: { error: "unauthorized" } });
    },
  );
  await page.goto("/");
  await page.getByTestId("user-input").fill("hello after a restart");
  await page.getByTestId("send-btn").click();
  await expect.poll(() => agentBearers.length).toBe(2);
  expect(agentBearers).toEqual([`Bearer ${E2E_AUTH_TOKEN}`, `Bearer ${ROTATED_TOKEN}`]);
  await expect(page.getByTestId(BANNER)).toHaveCount(0);
});

test("when index.html carries no token the banner appears, and its button reloads the page", async ({ page }) => {
  const indexHtmlLog = await serveIndexHtmlWithToken(page, "");
  await mockPubSubAccepting(page, E2E_AUTH_TOKEN);
  await mockHealthAccepting(page, null);
  await page.goto("/");
  await expect(page.getByTestId(BANNER)).toBeVisible();
  expect(indexHtmlLog.refetches).toBeGreaterThan(0);
  // The SPA has routed to the latest chat by now, so a reload is a document
  // request for THAT url — not a second navigation of `/`.
  const urlBeforeReload = page.url();
  const reload = page.waitForRequest((request) => request.isNavigationRequest());
  await page.getByTestId(RELOAD_BUTTON).click();
  expect((await reload).url()).toBe(urlBeforeReload);
  // The reloaded page boots against the same mocks and lands in the same
  // state; waiting for it keeps its boot calls inside this test's routes.
  await expect(page.getByTestId(BANNER)).toBeVisible();
});
