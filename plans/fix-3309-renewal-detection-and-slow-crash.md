# fix: language-independent renewal detection, and stop slow crash loops in `yarn dev` (#3309, part 3 of 3)

## Problems

1. `awaitTokenRenewal` decides that the PTY renewal worked by matching the CLI's reply against an
   English pattern (`Hello|Hi|I'm|I can|How can`). A user whose Claude answers in Japanese never
   matches, so every renewal waits the full 30 s timeout and is reported as failed — even when the
   CLI did refresh the token.
2. `scripts/dev-server.mjs` gives up only after consecutive crashes that each happen within 5 s of
   boot. A backend that fails after longer than that (33 s per cycle in #3309) resets the counter
   every time and is restarted forever. Part 1 stops the credentials case with a dedicated exit
   code; any other slow failure still loops.

## Approach

1. Judge the renewal by what it is supposed to produce: poll the Keychain (the same
   `readFromKeychain` + `classifyCredentials`) until it holds a valid token, or time out. The CLI's
   output is no longer read, so the language does not matter, and the CLI is stopped as soon as the
   token is valid. `looksLikeClaudeResponse` and its pattern go away. The polling loop is a small
   pure helper with an injected clock and sleep (`server/utils/pollUntil.ts`), tested without
   timers.
2. `restartPlan` also gives up when too many crashes land inside a recent window, however long
   each run lasted. The window check is pure (`tooManyRecentCrashes(crashTimesMs, nowMs)`), and
   the supervisor keeps only the recent crash times.

## Out of scope

Persisting the renewal failure count across restarts (declined in part 1 by the user's choice of a
startup exit code).
