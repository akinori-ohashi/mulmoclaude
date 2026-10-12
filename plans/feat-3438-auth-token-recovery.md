# feat: an open page follows a server restart on its own (#3438)

## Problem

The bearer token is regenerated at every server start, and a page reads it once from
`index.html`. After a restart every `/api/*` call from a page that stayed open answers 401, and the
`/ws/pubsub` handshake is refused (#3433). Only the socket refusal reached the user, as an amber
"Live updates were refused" banner with a Reload button; a send or a save failed with a bare
`unauthorized`, and because `failureResult` re-arms `backendReachable` on any HTTP reply, the red
offline banner cleared on the 401 and said nothing.

## Approach

Option 2 of the issue, with option 1 as its fallback. `index.html` is served without the token and
carries the current one on every request — the production handler substitutes it per request, and
the Vite plugin does the same for a loopback requester, the same requester as the page load — so the
page fetches it again instead of asking the user to.

### One recovery, two triggers

- `src/utils/auth/authTokenRecovery.ts` — `recoverAuthToken()` fetches `/` with `cache: "no-store"`
  and a timeout, reads the token out of the HTML, and installs it when it differs from the one the
  page holds. Concurrent callers share one in-flight fetch, so a burst of 401s plus the socket
  refusal cost one request. The outcome is one of `installed` / `unchanged` / `unavailable` /
  `unreachable`, and `authTokenStale` — the page-wide signal the issue asked to hoist — is set on
  `unavailable` and cleared on `installed`.
- `src/utils/api.ts` — a 401 recovers and, only when a different token was installed, re-issues the
  request once. One helper does it for `apiCall` and for `apiFetchRaw`: the chat send
  (`POST /api/agent`, an SSE stream, `src/utils/agent/request.ts`) goes through the raw escape
  hatch, and it is the call the issue describes failing with a bare `unauthorized` — the first
  real-app run showed it refused and left alone until the health poll recovered the page twelve
  seconds later. A request whose body is a stream is not re-issued (the first issue consumed it);
  no caller sends one today. A 401 the server sends for its own reasons
  (`/api/remote-host/reconnect` on an expired blob) comes back `unchanged` and reaches the caller
  as before. A token that `index.html` carried and the server still refuses sets `authTokenStale`;
  nothing retries a third time. The condition is a 401 whatever the page holds, not only "while a
  token is set": a page loaded before the server was up holds none, and the same fetch gives it one.
- `src/composables/usePubSub.ts` — a refusal (`socket.active` false) recovers and calls
  `socket.connect()` on `installed`; `auth` is a function, so the CONNECT re-reads the token. Any
  other outcome sets `authTokenStale`: a second refusal ends with the banner, not a loop. A socket
  that `maybeDisconnect` let go of while `/` was in flight is not reconnected.

### Why `unchanged` is not a stale token on the HTTP side but is on the socket

`grep -rn 'unauthorized(' server` finds three callers: `bearerAuth`, `viewToken` and the remote-host
reconnect route. The last one is an application 401, so a 401 whose token `index.html` still carries
cannot be read as "the page is stale" over HTTP. The socket middleware is the only thing that
refuses a handshake, so there a refusal of the token `index.html` carries means the page cannot
recover, and the banner is the right answer.

### One banner component

`BackendOfflineBanner`, `RemoteHostOfflineBanner` and `LiveUpdatesRefusedBanner` were near-identical
copies of one chrome. `src/components/StatusBanner.vue` owns it (tone, icon, title, body, optional
detail, one action button, test ids), and the three wrappers keep their own signal and action.
`LiveUpdatesRefusedBanner` becomes `AuthTokenStaleBanner`, driven by `authTokenStale`, with copy
that says what is true once auto-recovery has failed: this page needs a reload. The
`liveUpdatesRefused.*` keys become `authTokenStale.*` in all 8 locales.

### Token store moves out of `api.ts`

`setAuthToken` / `getAuthToken` move to `src/utils/auth/authToken.ts`: the recovery module needs
both, and `api.ts` needs the recovery module, so leaving the store in `api.ts` is an import cycle.
`main.ts`, `usePubSub.ts` and the tests import from the new path; nothing is re-exported.

## Tests

- `test/utils/test_authTokenHtml.ts` — the pure `extractAuthTokenFromHtml` over the served tag
  shape, attribute order, surrounding tags, missing tag, empty content.
- `test/utils/test_authTokenRecovery.ts` — every outcome against a scripted `fetch`, the request
  shape (`/`, `no-store`, a signal, no `Authorization`), the in-flight dedupe, and the signal
  transitions.
- `test/utils/test_api.ts` — the 401 rule in both directions: retry once with the new token, no
  retry on `unchanged`, stale on a refused retry, stale on `unavailable`, untouched when `/` is
  unreachable, no token set still recovers, concurrent 401s share one fetch, a 403 never fetches `/`.
- `e2e/tests/auth-token-recovery.spec.ts` — against `yarn dev:client` with a mocked socket and a
  `/` re-fetch answered with a rotated token: the refused socket reconnects with the new token and
  shows no banner; a 401 on `/api/health` is retried with the new bearer; `/` without a token shows
  the banner, whose button reloads the page.
- `e2e/tests/pubsub-handshake-auth.spec.ts` — kept, on the new test ids: a refusal of the token
  `index.html` still carries shows the banner and is not retried.
- `test/composables/test_useTranslatedQueries.ts` — its `settle()` helper counted microtasks and
  the retry helper adds an awaited hop inside `apiCall`; it waits on a timer tick now.

## Verification beyond the suite

`api.ts` is on the path of every frontend request, so the real app is driven: production-mode
server, a page left open, server restarted under it; the page's next call and the socket both
recover without a reload, the server log shows one refused handshake and the accepted reconnect,
and no banner appears. The remote-host reconnect 401 is exercised through the unit test only.

## Out of scope

- What the server does with a stale token: it refuses, and that is right.
