# fix(telegram): streamed reply duplicates, leaks its timer, or swallows an error (#3548)

## Defects (all in `packages/bridges/telegram/src/router.ts`)

1. The final flush started `sendMessage` without awaiting it, so the message id was still `null` and the full reply was sent again as a second message.
2. A throw from `sendToMulmo` skipped `stopStream()`, leaving the edit timer running against shared state.
3. Streamed text followed by an `ok: false` ack matched neither branch of `deliverFinal`; the error was never shown.

## Fix

- New `src/stream.ts`: `createReplyStream(api, chatId, log, interval_ms)`, one per request.
  - Flushes are serialized through a promise chain, so a slow first `sendMessage` settles before the next flush picks send vs edit (this also stops a timer tick from sending a second message while the first is in flight).
  - `finish()` stops the timer, flushes, and resolves to the streamed message id.
- `router.ts`: `streamWhile` creates the stream, runs `sendToMulmo`, and stops the stream in `finally`. `handleTextChunk` appends to the in-flight stream only.
- `deliverFinal`: edit in place only when streamed **and** `ack.ok`; every other case goes through `sendReply` (so the error is sent after the partial text).

## Out of scope

- A throw from `handleMessage` still propagates to the polling loop in `start.ts` (unchanged behaviour).
- A streamed reply longer than 4096 chars still fails the final edit silently (pre-existing).

## Tests

- `test/test_stream.ts`: slow first send, send started by the timer, no chunks, stop, failed send.
- `test/test_router.ts`: one case per defect; each fails on the old `router.ts` and passes on the new one.
