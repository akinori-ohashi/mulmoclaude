# fix: keep agent errors in the session history (#3288)

## Problem

`handleAgentEvent` broadcasts `error` events live but never writes them to the session
JSONL, and neither does the `runAgentInBackground` catch. After a reload a failed turn
shows the user's message and nothing else — the error and its advice (e.g. #3284's
`claude /login` hint) are gone.

## Change

- Server (`server/api/routes/agent.ts`): after flushing accumulated text, append
  `{ source: "assistant", type: "error", message }` for every error that reaches
  `handleAgentEvent`, and for the one the catch block publishes.
- An error `detectRecovery` swallows (stale session, broker not ready) while a retry
  is still available never reaches `handleAgentEvent`, so a recovered turn leaves no
  error in history. Once retries are exhausted the error is not swallowed; it takes the
  normal path and IS persisted, which is intended: that turn really failed.
- Client: `ErrorEntry` / `isErrorEntry` in `src/types/session.ts`; `parseSessionEntries`
  replays it through the same `makeErrorResult` the live path uses, so a reloaded error
  card is identical to the live one.

## Why a distinct `type: "error"`, not an assistant `text` line

Readers that treat `source: "assistant"` + `type: "text"` as the model's reply (indexing,
summaries, journal, last-reply lookups) must not start ingesting error strings. A new
type is ignored by every reader that filters on `type` — the readers were surveyed for
any that key on `source` alone.
