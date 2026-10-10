# fix: chat-service handshake — constant-time compare, generic refusal, no open-by-default (#3439)

## Problem

`validateHandshake` in `@mulmobridge/chat-service` guards `/ws/chat` with the same per-startup
token as `bearerAuth` and the `/ws/pubsub` guard (#3433), on the same relayed port, but it
compares with `!==`, answers with distinguishing messages (`token is required`, `invalid token`,
`server auth not ready`) where the other two surfaces say only `unauthorized`, and accepts every
handshake when no `tokenProvider` is given. The two webhook bridges (`@mulmobridge/webhook`,
`@mulmobridge/twilio-sms`) still compare string lengths before `timingSafeEqual` and mask the
resulting throw with `try/catch`.

## Approach

One copy of the bearer rule, in the one tier every consumer can import.

### `@mulmoclaude/common/token-guard` — a new Node-only subpath

`tokenEquals`, `isAuthorizedToken` and `UNAUTHORIZED_MESSAGE` move here verbatim from
`server/api/auth/tokenGuard.ts`, with their tests. The main entry of `@mulmoclaude/common` stays
browser-safe; this subpath uses `node:crypto`, the way `./ssrf` is pure and `./meta-webhook` is
isomorphic — each entry says what it may import. The host's `bearerAuth`, `viewToken` and the
pubsub `handshakeAuth` import from the subpath, and the host file goes.

### `@mulmobridge/chat-service`

- `src/handshake.ts` — `validateHandshake(auth, expectedToken)` is pure over the raw
  `handshake.auth` and the current token, so it is tested without a socket. The token is checked
  first, through `isAuthorizedToken`; every failure of it — `auth` not a record, token missing,
  empty, wrong, same character count with multi-byte characters, a server that has no token yet —
  refuses with `UNAUTHORIZED_MESSAGE`, so the reply says nothing about which it was. Only after
  the token passes does the rule read `transportId` (`transportId is required`) and sanitise
  `options`. `sanitiseOptions` moves here with it, unchanged in behaviour (`isRecord` replaces the
  inline object check and its cast).
- `src/socket.ts` — `tokenProvider` is required on `ChatSocketDeps` and `ChatServiceDeps`, so a
  chat socket cannot be opened without the check; the host already passes `getCurrentToken`. One
  `logger.warn` per refused connection, with the peer address and never the token, as the pubsub
  guard does.
- Published as 2.0.0: a required field where there was an optional one, and the refusal messages
  are wire-visible.

### `@mulmobridge/client`

`installDefaultLogging` recognised `invalid token` and `server auth not ready` as "the token was
rejected". `isTokenRefusal` in `supervisor.ts` makes that decision testable and adds
`unauthorized`; the two old strings stay so a new bridge against an older server keeps the hint.

### The bridges and the mock

- `@mulmobridge/webhook` — `secretOk` compares through `tokenEquals`.
- `@mulmobridge/twilio-sms` — `signatureValid` goes through `verifyHmacSignature` from
  `@mulmobridge/webhook-runtime`, which already compares byte lengths; the bridge keeps only the
  Twilio-specific construction of the signed data.
- `@mulmobridge/mock-server` — mirrors the real handshake: `isAuthorizedToken`, `unauthorized`.
- The two root tests that fake a chat server (`test/bridges/`) refuse with `UNAUTHORIZED_MESSAGE`.

### Versions and ranges

`common` 1.5.0 (new subpath), `chat-service` 2.0.0, `client` 1.4.2, `webhook` 1.1.2,
`twilio-sms` 1.1.2, `mock-server` 1.1.0. Every declared range on `common`, `client` and
`chat-service` is swept to the new version, and the CHANGELOG `[Unreleased]` section states the
launcher roster. Publish order: `common` → `client` → `chat-service` → the bridges and the mock
→ the launcher.

## Tests

- `packages/common/test/test_token_guard.ts` — the moved `test_tokenGuard.ts`.
- `packages/chat-service/test/test_handshake.ts` — the rule in both directions over every input
  shape, the ordering (a bad token with no `transportId` is `unauthorized`), and that no input throws.
- `packages/chat-service/test/test_socket.ts` — real server + real client: every token refusal is
  `unauthorized`; the former no-auth harness now carries a token.
- `packages/client/test/test_supervisor.ts` — `isTokenRefusal`.
- Behaviour preservation of the moved compares (`secretOk`, `signatureValid`, `sanitiseOptions`)
  is shown by running the old and new code side by side over generated inputs before the old code
  goes.

## Out of scope

- `verifyHmacSignature` in `@mulmobridge/webhook-runtime` already compares byte lengths; it is
  used, not changed.
- Exposing the server beyond loopback still needs an authenticating proxy in front (#3425).
