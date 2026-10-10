import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiCall, apiGet, apiPost, apiPut, apiDelete, apiFetchRaw, backendReachable, isProxyUnreachable, lastBackendError } from "../../src/utils/api.ts";
import { getAuthToken, setAuthToken } from "../../src/utils/auth/authToken.ts";
import { authTokenStale } from "../../src/utils/auth/authTokenRecovery.ts";

// fetch mocking. Capture the URL + init passed by the api module, and
// reply with a pre-scripted response. Each test installs its own mock
// and restores the original fetch in afterEach.

// Match fetch's signature without importing DOM lib types by deriving
// everything from `typeof fetch`.
type FetchFn = typeof fetch;
type FetchInit = Parameters<FetchFn>[1];

interface MockCall {
  url: string;
  init: FetchInit;
}
let calls: MockCall[] = [];
let nextResponse: Response = new Response("", { status: 200 });
const originalFetch = globalThis.fetch;

function installMock(): void {
  calls = [];
  const mock: FetchFn = (url, init) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(nextResponse.clone());
  };
  globalThis.fetch = mock;
}

function restoreMock(): void {
  globalThis.fetch = originalFetch;
}

// Access headers off a captured init without needing a DOM-lib
// `HeadersInit` import. api.ts always passes a plain string map.
function getHeader(call: MockCall, name: string): string | undefined {
  const headers = call.init?.headers;
  if (!headers || typeof headers !== "object") return undefined;
  const record: Record<string, unknown> = { ...headers };
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

// Every test below drives a single request, so the captured call must be
// there — a missing one is a failure, not something to read past.
function firstCall(): MockCall {
  const [call] = calls;
  assert.ok(call, "expected the api module to have issued a fetch");
  return call;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiCall — happy path", () => {
  beforeEach(installMock);
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
  });

  it("GET returns parsed JSON on 200", async () => {
    nextResponse = jsonResponse(200, { hello: "world" });
    const result = await apiGet<{ hello: string }>("/api/thing");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.hello, "world");
  });

  it("POST serializes body as JSON and sets Content-Type", async () => {
    nextResponse = jsonResponse(200, { ok: true });
    await apiPost("/api/thing", { a: 1, b: "two" });
    const call = firstCall();
    assert.equal(call.init?.method, "POST");
    assert.equal(getHeader(call, "Content-Type"), "application/json");
    assert.equal(call.init?.body, JSON.stringify({ a: 1, b: "two" }));
  });

  it("PUT forwards the method", async () => {
    nextResponse = jsonResponse(200, {});
    await apiPut("/api/thing", { x: 1 });
    assert.equal(firstCall().init?.method, "PUT");
  });

  it("DELETE accepts an optional body", async () => {
    nextResponse = jsonResponse(200, {});
    await apiDelete("/api/thing/1");
    const call = firstCall();
    assert.equal(call.init?.method, "DELETE");
    assert.equal(call.init?.body, undefined);
  });
});

describe("apiCall — errors", () => {
  beforeEach(installMock);
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
  });

  it("non-2xx with JSON { error } body surfaces the server message", async () => {
    nextResponse = jsonResponse(400, { error: "bad shape" });
    const result = await apiPost("/api/thing", { bogus: true });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "bad shape");
      assert.equal(result.status, 400);
    }
  });

  it("non-2xx without a JSON body falls back to statusText", async () => {
    nextResponse = new Response("not found", {
      status: 404,
      statusText: "Not Found",
    });
    const result = await apiGet("/api/thing/999");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "Not Found");
      assert.equal(result.status, 404);
    }
  });

  it("network failure returns { ok: false, status: 0 }", async () => {
    const failing: FetchFn = () => Promise.reject(new Error("ECONNREFUSED"));
    globalThis.fetch = failing;
    const result = await apiGet("/api/thing");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "ECONNREFUSED");
      assert.equal(result.status, 0);
    }
  });

  it("200 with invalid JSON surfaces a parse error", async () => {
    nextResponse = new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await apiGet("/api/thing");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Invalid JSON/);
  });
});

describe("apiCall — query and headers", () => {
  beforeEach(installMock);
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
  });

  it("appends a query string from the query object", async () => {
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/search", { q: "hello", limit: 10 });
    const { url } = firstCall();
    assert.match(url, /\/api\/search\?/);
    assert.match(url, /q=hello/);
    assert.match(url, /limit=10/);
  });

  it("drops undefined query values", async () => {
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/search", { q: "x", missing: undefined });
    assert.doesNotMatch(firstCall().url, /missing=/);
  });

  it("percent-encodes query values", async () => {
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/search", { q: "a b&c" });
    assert.match(firstCall().url, /q=a%20b%26c/);
  });

  it("includes the bearer token when set", async () => {
    setAuthToken("secret123");
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/thing");
    assert.equal(getHeader(firstCall(), "Authorization"), "Bearer secret123");
  });

  it("omits Authorization when no token set", async () => {
    setAuthToken(null);
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/thing");
    assert.equal(getHeader(firstCall(), "Authorization"), undefined);
  });

  it("caller-provided headers survive", async () => {
    nextResponse = jsonResponse(200, {});
    await apiCall("/api/thing", {
      method: "GET",
      headers: { "X-Custom": "1" },
    });
    assert.equal(getHeader(firstCall(), "X-Custom"), "1");
  });
});

// #1479 — backend-reachability signal. A `fetch` throw flips
// `backendReachable` false (with the error message stored); any
// subsequent HTTP reply (including 4xx/5xx) flips it back true.
describe("apiCall — backendReachable signal", () => {
  beforeEach(() => {
    backendReachable.value = true;
    lastBackendError.value = null;
  });
  afterEach(restoreMock);

  it("flips to false on a fetch throw (network error / ERR_CONNECTION_REFUSED)", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("connection refused"))) as typeof fetch;
    const result = await apiCall("/api/anything");
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.status, 0);
      assert.match(result.error, /connection refused/);
    }
    assert.equal(backendReachable.value, false);
    assert.match(lastBackendError.value ?? "", /connection refused/);
  });

  it("flips back to true on the next successful HTTP reply", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("down"))) as typeof fetch;
    await apiCall("/api/anything");
    assert.equal(backendReachable.value, false);

    installMock();
    nextResponse = jsonResponse(200, { ok: true });
    await apiCall("/api/anything");
    assert.equal(backendReachable.value, true);
    assert.equal(lastBackendError.value, null);
  });

  it("flips back to true even when the HTTP reply is a 4xx/5xx", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("down"))) as typeof fetch;
    await apiCall("/api/anything");
    assert.equal(backendReachable.value, false);

    installMock();
    nextResponse = jsonResponse(500, { error: "boom" });
    await apiCall("/api/anything");
    // Server replied → backend is reachable, even though the request itself failed.
    assert.equal(backendReachable.value, true);
  });

  it("does NOT flip on caller-driven AbortError (normal cancel flow)", async () => {
    // Simulate `AbortController.abort()` mid-flight: fetch rejects
    // with a DOMException-shaped AbortError. This is a normal
    // navigation/race flow — must not surface as backend-offline.
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    globalThis.fetch = (() => Promise.reject(abortErr)) as typeof fetch;
    const result = await apiCall("/api/anything");
    assert.equal(result.ok, false);
    assert.equal(backendReachable.value, true);
    assert.equal(lastBackendError.value, null);
  });
});

// #2975 — a proxy that cannot reach the backend answers with a status of its
// own, so the reply-means-reachable rule above used to read an outage as a
// healthy server: the offline banner stayed hidden and `res.statusText` — the
// bare string "Bad Gateway" — became the error the user saw. Vite's dev proxy
// does exactly this on ECONNREFUSED (verified: 502, `text/plain`, empty body),
// which is why `yarn dev` before the backend finished booting showed it.
describe("apiCall — proxy-level outage (#2975)", () => {
  beforeEach(() => {
    installMock();
    backendReachable.value = true;
    lastBackendError.value = null;
  });
  afterEach(restoreMock);

  // The shape Vite hands back: `res.writeHead(502, {...}).end()`.
  function bodylessGateway(status: number): Response {
    return new Response("", { status, headers: { "Content-Type": "text/plain" } });
  }

  [502, 503, 504].forEach((status) => {
    it(`treats a body-less ${status} as backend-unreachable`, async () => {
      nextResponse = bodylessGateway(status);
      const result = await apiCall("/api/anything");
      assert.equal(result.ok, false);
      assert.equal(backendReachable.value, false);
      if (result.ok === false) {
        // The status survives for callers that branch on it...
        assert.equal(result.status, status);
        // ...but "Bad Gateway" does not reach the user, and what replaces
        // it is a protocol constant rather than untranslated English prose
        // (the banner supplies the sentence, in the user's own locale).
        assert.doesNotMatch(result.error, /Bad Gateway/);
        assert.equal(result.error, `HTTP ${status}`);
      }
      assert.match(lastBackendError.value ?? "", new RegExp(String(status)));
    });
  });

  // The discriminator, and the reason it is the body rather than the status:
  // `server/api/routes/skills.ts` answers a failed external skill install with
  // a real 502, and that is the backend talking. Reading it as an outage would
  // raise the offline banner over a working server.
  it("leaves a 502 that carries the server's own JSON error alone", async () => {
    nextResponse = jsonResponse(502, { error: "external install failed: registry timeout" });
    const result = await apiCall("/api/skills/install");
    assert.equal(result.ok, false);
    assert.equal(backendReachable.value, true);
    assert.equal(lastBackendError.value, null);
    if (result.ok === false) assert.match(result.error, /external install failed/);
  });

  it("recovers on the next real reply, as the health poll drives it", async () => {
    nextResponse = bodylessGateway(502);
    await apiCall("/api/health");
    assert.equal(backendReachable.value, false);

    nextResponse = jsonResponse(200, { ok: true });
    await apiCall("/api/health");
    assert.equal(backendReachable.value, true);
    assert.equal(lastBackendError.value, null);
  });
});

describe("isProxyUnreachable", () => {
  it("is true only for gateway statuses with no app-authored body", () => {
    assert.equal(isProxyUnreachable(502, false), true);
    assert.equal(isProxyUnreachable(503, false), true);
    assert.equal(isProxyUnreachable(504, false), true);
    assert.equal(isProxyUnreachable(502, true), false);
    // 500 is the server itself failing — it replied, so it is reachable.
    assert.equal(isProxyUnreachable(500, false), false);
    assert.equal(isProxyUnreachable(401, false), false);
    assert.equal(isProxyUnreachable(404, false), false);
  });
});

// #3438 — a 401 is what a server restart looks like from a page that stayed
// open. `apiCall` fetches index.html again, installs the token it carries and
// retries once; a 401 the server sends for its own reasons leaves the token
// unchanged and is returned as is.
describe("apiCall — stale token recovery (#3438)", () => {
  const INDEX_HTML_PATH = "/";
  const API_PATH = "/api/thing";

  function indexHtml(token: string): Response {
    const html = `<!doctype html><html><head><meta name="mulmoclaude-auth" content="${token}" /></head><body></body></html>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  }

  type Responder = (url: string, bearer: string | undefined) => Response | Promise<Response>;

  /** Answer every fetch by URL and bearer, recording each call. */
  function installResponder(respond: Responder): void {
    calls = [];
    const mock: FetchFn = (url, init) => {
      const call = { url: String(url), init };
      calls.push(call);
      return Promise.resolve(respond(call.url, getHeader(call, "Authorization")));
    };
    globalThis.fetch = mock;
  }

  /** An API that accepts one bearer and refuses every other with a 401, with
   *  index.html answered by `index`. */
  function serverWith(index: () => Response | Promise<Response>, acceptedToken: string): Responder {
    return (url, bearer) => {
      if (url === INDEX_HTML_PATH) return index();
      return bearer === `Bearer ${acceptedToken}` ? jsonResponse(200, { ok: true }) : jsonResponse(401, { error: "unauthorized" });
    };
  }

  function callAt(index: number): MockCall {
    const call = calls[index];
    assert.ok(call, `expected a fetch at index ${index}`);
    return call;
  }

  beforeEach(() => {
    setAuthToken("stale");
    authTokenStale.value = false;
    backendReachable.value = true;
  });
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
    authTokenStale.value = false;
  });

  it("fetches index.html on a 401 and retries once with the token it carries", async () => {
    installResponder(serverWith(() => indexHtml("fresh"), "fresh"));
    const result = await apiPost(API_PATH, { a: 1 });
    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH, INDEX_HTML_PATH, API_PATH],
    );
    // index.html is fetched the way a navigation would: no bearer, no cache.
    assert.equal(getHeader(callAt(1), "Authorization"), undefined);
    assert.equal(callAt(1).init?.cache, "no-store");
    // The retry is the same request with the new token.
    assert.equal(getHeader(callAt(2), "Authorization"), "Bearer fresh");
    assert.equal(callAt(2).init?.method, "POST");
    assert.equal(callAt(2).init?.body, JSON.stringify({ a: 1 }));
    assert.equal(getAuthToken(), "fresh");
    assert.equal(authTokenStale.value, false);
  });

  it("returns the 401 as is when index.html still carries the token the server refused", async () => {
    installResponder(serverWith(() => indexHtml("stale"), "something-else"));
    const result = await apiGet(API_PATH);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH, INDEX_HTML_PATH],
    );
    assert.equal(getAuthToken(), "stale");
    // An application 401 is not a stale page.
    assert.equal(authTokenStale.value, false);
  });

  it("reports a stale token when the server also refuses the one index.html carries", async () => {
    installResponder(serverWith(() => indexHtml("fresh"), "neither"));
    const result = await apiGet(API_PATH);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH, INDEX_HTML_PATH, API_PATH],
    );
    assert.equal(authTokenStale.value, true);
  });

  it("reports a stale token when index.html carries none", async () => {
    installResponder(serverWith(() => indexHtml(""), "fresh"));
    const result = await apiGet(API_PATH);
    assert.equal(result.ok, false);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH, INDEX_HTML_PATH],
    );
    assert.equal(getAuthToken(), "stale");
    assert.equal(authTokenStale.value, true);
  });

  it("leaves a 401 alone while index.html cannot be fetched", async () => {
    installResponder(serverWith(() => Promise.reject(new Error("offline")), "fresh"));
    const result = await apiGet(API_PATH);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    assert.equal(getAuthToken(), "stale");
    // That is the offline banner's territory, not this one's.
    assert.equal(authTokenStale.value, false);
  });

  it("recovers a page that holds no token at all the same way", async () => {
    setAuthToken(null);
    installResponder(serverWith(() => indexHtml("fresh"), "fresh"));
    const result = await apiGet(API_PATH);
    assert.equal(result.ok, true);
    assert.equal(getHeader(callAt(0), "Authorization"), undefined);
    assert.equal(getHeader(callAt(2), "Authorization"), "Bearer fresh");
    assert.equal(getAuthToken(), "fresh");
  });

  it("shares one index.html fetch between concurrent 401s", async () => {
    installResponder(serverWith(() => indexHtml("fresh"), "fresh"));
    const results = await Promise.all([apiGet("/api/one"), apiGet("/api/two")]);
    assert.deepEqual(
      results.map((result) => result.ok),
      [true, true],
    );
    assert.equal(calls.filter((call) => call.url === INDEX_HTML_PATH).length, 1);
    assert.equal(calls.length, 5);
  });

  it("never fetches index.html for a refusal other than 401", async () => {
    installResponder(() => jsonResponse(403, { error: "forbidden" }));
    const result = await apiGet(API_PATH);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH],
    );
    assert.equal(authTokenStale.value, false);
  });

  // The chat send (`POST /api/agent`, an SSE stream) goes through the raw
  // escape hatch, so it needs the same retry — it is the call the issue
  // describes failing with a bare `unauthorized`.
  it("apiFetchRaw retries a 401 once with the recovered token, re-sending the body", async () => {
    installResponder(serverWith(() => indexHtml("fresh"), "fresh"));
    const rawResponse = await apiFetchRaw(API_PATH, {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(rawResponse.status, 200);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH, INDEX_HTML_PATH, API_PATH],
    );
    assert.equal(getHeader(callAt(2), "Authorization"), "Bearer fresh");
    assert.equal(callAt(2).init?.body, JSON.stringify({ message: "hi" }));
    assert.equal(getHeader(callAt(2), "Content-Type"), "application/json");
  });

  it("apiFetchRaw hands back the 401 when index.html still carries the refused token", async () => {
    installResponder(serverWith(() => indexHtml("stale"), "something-else"));
    const rawResponse = await apiFetchRaw(API_PATH);
    assert.equal(rawResponse.status, 401);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH, INDEX_HTML_PATH],
    );
    assert.equal(authTokenStale.value, false);
  });

  it("apiFetchRaw does not retry a request whose body is a stream, which the first issue consumed", async () => {
    installResponder(serverWith(() => indexHtml("fresh"), "fresh"));
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    });
    const rawResponse = await apiFetchRaw(API_PATH, { method: "POST", body: streamBody });
    assert.equal(rawResponse.status, 401);
    assert.deepEqual(
      calls.map((call) => call.url),
      [API_PATH],
    );
  });
});

// The classification rule, swept across body shapes rather than asserted on
// the one shape that motivated it. Harvested from the differential harness
// that proved the `apiCall` split behaviour-preserving (244 generated cases,
// 0 mismatches) — the harness itself could not survive, since half of it was
// the pre-split code, but the generator and the property it established can.
//
// The property: `backendReachable` goes false exactly when the status is a
// gateway status AND the body carries no app-authored `{ error: string }`.
// Body *emptiness* is deliberately NOT the discriminator (CodeRabbit
// suggested it): a real reverse proxy in front of the app — nginx
// and friends — answers an unreachable upstream with an HTML error PAGE, and
// requiring an empty body would suppress the banner in exactly the case it
// exists for. What separates the two is authorship, not length.
describe("apiCall — reachability classification across body shapes", () => {
  const GATEWAY = [502, 503, 504];
  const NON_GATEWAY = [400, 401, 404, 409, 500, 501, 599];

  // `authored` = the body is the server's own `{ error: string }` envelope.
  const SHAPES: { name: string; body: string; ctype: string; authored: boolean }[] = [
    { name: "app JSON error envelope", body: JSON.stringify({ error: "boom" }), ctype: "application/json", authored: true },
    { name: "empty body (Vite dev proxy)", body: "", ctype: "text/plain", authored: false },
    { name: "nginx-style HTML error page", body: "<html><title>502 Bad Gateway</title></html>", ctype: "text/html", authored: false },
    { name: "bare plain text", body: "upstream connect error", ctype: "text/plain", authored: false },
    { name: "malformed JSON", body: "{not json", ctype: "application/json", authored: false },
    { name: "JSON without an error key", body: JSON.stringify({ detail: "x" }), ctype: "application/json", authored: false },
    { name: "JSON whose error is not a string", body: JSON.stringify({ error: 42 }), ctype: "application/json", authored: false },
  ];

  beforeEach(installMock);
  afterEach(restoreMock);

  SHAPES.forEach((shape) => {
    GATEWAY.forEach((status) => {
      it(`${status} + ${shape.name} → ${shape.authored ? "reachable" : "UNREACHABLE"}`, async () => {
        backendReachable.value = true;
        lastBackendError.value = null;
        nextResponse = new Response(shape.body, { status, headers: { "Content-Type": shape.ctype } });
        await apiCall("/api/anything");
        assert.equal(backendReachable.value, shape.authored);
      });
    });

    NON_GATEWAY.forEach((status) => {
      it(`${status} + ${shape.name} → reachable (the server answered)`, async () => {
        backendReachable.value = true;
        lastBackendError.value = null;
        nextResponse = new Response(shape.body, { status, headers: { "Content-Type": shape.ctype } });
        await apiCall("/api/anything");
        assert.equal(backendReachable.value, true);
      });
    });
  });
});
