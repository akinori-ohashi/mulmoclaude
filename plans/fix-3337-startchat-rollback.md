# fix: roll back the run when startChat fails after beginRun (#3337)

## Problem

`startChat()` marks the session running with `beginRun()`, then awaits
`persistUserTurn()` and `dispatchAgentRun()`. Only the attachment block before
them rolls back on failure. A throw from the session writes (`createSessionMeta`,
`backfillMeta`, `incrementUserQueryCount`, `appendSessionLine`) or the pre-launch
reads left the session `isRunning` with no `sessionFinished`, so every later turn
got 409 until the server restarted.

Reproduced in-process: occupying the transcript path with a directory makes
`appendSessionLine` throw `EISDIR`; on `main` the call rejects and the session
stays running.

## Fix

- Wrap `persistUserTurn` + `dispatchAgentRun` in `try/catch`; on failure
  `abortController.abort()` + `endRun()` and return `{ kind: "error", status: 500 }`
  rather than rejecting, so every caller takes its existing error path.
- The attachment rollback and this one share `rollBackRun()`.

## Out of scope

- A user line already appended before a later step fails stays in the transcript.
  The session is usable again, which is what the issue is about.

## Test

`test/agent/test_startChatRollback.ts` — red on `main`, green with the fix.
