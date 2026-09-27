# fix: a bridge message waits for the running agent instead of being dropped (#3320)

## Problem

A bridge turn cut off at its reply limit leaves its agent running
(`collectAgentReply` only unsubscribes). The next turn's `startChat()` then
returns 409 (`beginRun` refuses a running session) and the relay answered
"A previous message is still being processed. Please wait." — the message
never reached the agent.

## Decision (issue comment on #3320)

Wait for the running agent to finish, within the message's remaining time
(the receipt-based deadline from #3312), then start.

- `startChatWhenIdle` (`packages/chat-service/src/start-when-idle.ts`):
  on 409, subscribe to the session's `sessionFinished`, then retry
  `startChat()` once before waiting — a run that ended between the 409 and the
  subscription would otherwise be missed and the wait would run out the limit.
  After each finish, try again (another run may have taken the session).
- Out of time → `{ kind: "expired" }` → the relay's "timed out before the
  agent could start" reply; the agent is not started.
- Retrying is safe: `startChat()` returns 409 before it saves or broadcasts
  anything.

Chat-service only; no host change. Stopping the agent (`cancelRun`) was
rejected: it throws away work that is still visible in the web UI.

## Out of scope

Delivering the text a cut-off agent produces afterwards (push path).
