# feat(bridges): processing indicator on LINE and Telegram (#3541)

## Problem

Discord shows "typing…" while it waits for the reply (#3536, `@mulmobridge/discord@1.4.0`). LINE and Telegram show nothing: LINE awaits `client.send()` and then `pushMessage`, and Telegram is silent until the first streamed chunk, and again while tools run.

## Plan — three PRs, each revertable on its own

1. **client** (this file's first PR): move Discord's `typing.ts` into `@mulmobridge/client` as `processingIndicator.ts`.
   - `refreshMs` becomes a required option, because each platform keeps its indicator up for a different time. `label` prefixes the failure log.
   - Discord switches to the client export, keeping its own 8 s refresh.
   - The tests move with the code and keep their assertions.
   - client 1.4.2 → 1.5.0, because it gains exports and the `@mulmobridge/*` drift gate requires the bump in the same PR. Every `@mulmobridge/client` range is swept to `^1.5.0`, root included.
2. **LINE**: `POST /v2/bot/chat/loading/start` with a short `loadingSeconds`, refreshed before it lapses. It works in one-to-one chats only, so a failure is a `warn`. The short value bounds how long a stray request that crosses the post can keep the animation up.
3. **Telegram**: add `sendChatAction` to `api.ts` and send `typing` (it lasts about 5 s) until the final reply, which also covers the gaps while streaming.

## Publish order

`@mulmobridge/client` 1.5.0 → `discord`, `line`, `telegram`.
