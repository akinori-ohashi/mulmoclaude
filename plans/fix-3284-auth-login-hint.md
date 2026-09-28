# fix: tell the user to run `claude /login` when the CLI's auth fails (#3284)

## Problem

When the spawned `claude` CLI cannot authenticate, the chat shows the CLI's text as an
ordinary reply, then a separate `[Error] claude exited with code 1`. Under `-p` the CLI's
wording (`Failed to authenticate: OAuth session expired and could not be refreshed`)
drops the `/login` advice it shows interactively, so nothing tells the user what to do.

## What the CLI actually emits (reproduced with a bogus `CLAUDE_CODE_OAUTH_TOKEN`)

1. `assistant` frame, `model: "<synthetic>"`, top-level `error: "authentication_failed"`,
   the failure text as a text block.
2. `result` frame, `is_error: true`, same text.
3. Exit code 1, empty stderr.

## Change

- `server/agent/authFailure.ts` (pure): `isAuthFailureFrame` keys on the structured
  `error` field, not the wording; `authFailureMessage` appends the fix.
- `server/agent/stream.ts`: the parser turns that frame into an `error` event and marks
  text as emitted so the `result` frame does not repeat it as a reply.
- `server/agent/backend/claude-code.ts`: `isRedundantExitError` drops the bare exit-code
  error once the stream surfaced one AND stderr is empty.
- `packages/core/assets/helps/error-recovery.md`: new section for the agent.

## Out of scope

Other `error` kinds on the same frame (`rate_limit`, `billing_error`, …) still render as
text; only `authentication_failed` is re-routed. The hint is English, like the other
server-built error strings.
