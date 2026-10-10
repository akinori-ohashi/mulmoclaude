import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAuthToken, setAuthToken } from "../../src/utils/auth/authToken.ts";
import { authTokenStale, recoverAuthToken, recoveryOutcome } from "../../src/utils/auth/authTokenRecovery.ts";

// fetch mocking, the same shape as `test_api.ts`: capture what the module
// sent, answer with a scripted response.
type FetchFn = typeof fetch;
type FetchInit = Parameters<FetchFn>[1];

interface FetchCall {
  url: string;
  init: FetchInit;
}
let calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function scriptFetch(reply: () => Response | Promise<Response>): void {
  calls = [];
  const mock: FetchFn = (url, init) => {
    calls.push({ url: String(url), init });
    return Promise.resolve().then(reply);
  };
  globalThis.fetch = mock;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

function indexHtml(token: string): Response {
  return htmlResponse(`<!doctype html><html><head><meta name="mulmoclaude-auth" content="${token}" /></head><body></body></html>`);
}

function firstCall(): FetchCall {
  const [call] = calls;
  assert.ok(call, "expected the module to have fetched index.html");
  return call;
}

describe("recoveryOutcome", () => {
  it("installs a token that differs from the held one, including when none is held", () => {
    assert.equal(recoveryOutcome("stale", "fresh"), "installed");
    assert.equal(recoveryOutcome(null, "fresh"), "installed");
  });

  it("is unchanged when index.html carries the held token", () => {
    assert.equal(recoveryOutcome("stale", "stale"), "unchanged");
  });

  it("is unavailable when index.html carries none, whatever is held", () => {
    assert.equal(recoveryOutcome("stale", null), "unavailable");
    assert.equal(recoveryOutcome(null, null), "unavailable");
  });
});

describe("recoverAuthToken", () => {
  beforeEach(() => {
    setAuthToken("stale");
    authTokenStale.value = false;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAuthToken(null);
    authTokenStale.value = false;
  });

  it("fetches index.html the way a navigation would: no bearer, no cache, with a timeout signal", async () => {
    scriptFetch(() => indexHtml("fresh"));
    await recoverAuthToken();
    const { url, init } = firstCall();
    assert.equal(url, "/");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init?.headers, undefined);
  });

  it("installs a different token and clears the stale signal", async () => {
    authTokenStale.value = true;
    scriptFetch(() => indexHtml("fresh"));
    assert.equal(await recoverAuthToken(), "installed");
    assert.equal(getAuthToken(), "fresh");
    assert.equal(authTokenStale.value, false);
  });

  it("leaves the token and the signal alone when index.html carries the held one", async () => {
    scriptFetch(() => indexHtml("stale"));
    assert.equal(await recoverAuthToken(), "unchanged");
    assert.equal(getAuthToken(), "stale");
    assert.equal(authTokenStale.value, false);
  });

  it("raises the stale signal when index.html carries no token", async () => {
    scriptFetch(() => indexHtml(""));
    assert.equal(await recoverAuthToken(), "unavailable");
    assert.equal(getAuthToken(), "stale");
    assert.equal(authTokenStale.value, true);
  });

  it("reads a reply other than 2xx as served without a token", async () => {
    scriptFetch(() => htmlResponse("not here", 404));
    assert.equal(await recoverAuthToken(), "unavailable");
    assert.equal(authTokenStale.value, true);
  });

  it("reports unreachable, touching nothing, when the fetch itself fails", async () => {
    scriptFetch(() => Promise.reject(new Error("connection refused")));
    assert.equal(await recoverAuthToken(), "unreachable");
    assert.equal(getAuthToken(), "stale");
    assert.equal(authTokenStale.value, false);
  });

  it("shares one fetch between concurrent callers, and fetches again for a later one", async () => {
    scriptFetch(() => indexHtml("fresh"));
    const outcomes = await Promise.all([recoverAuthToken(), recoverAuthToken()]);
    assert.deepEqual(outcomes, ["installed", "installed"]);
    assert.equal(calls.length, 1);
    assert.equal(await recoverAuthToken(), "unchanged");
    assert.equal(calls.length, 2);
  });
});
