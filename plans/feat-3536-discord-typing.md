# feat(discord): keep the typing indicator up while waiting for the reply (#3536)

## Problem

`relayMessage()` in `packages/bridges/discord/src/index.ts` downloads attachments,
awaits `mulmo.send()` and only then posts. Nothing shows in Discord meanwhile, so
during a multi-minute agent turn the user cannot tell "being processed" from
"bridge is dead".

## Scope

**In:** Discord bridge only. Show "typing…" from receipt until the reply is posted.
No new setting.

**Out:** the same for LINE (`/v2/bot/chat/loading/start`) and Telegram
(`sendChatAction typing`) — separate issues if wanted.

## Design

- `src/typing.ts` — `startTypingIndicator(sendTyping, options)`, pure (timers and
  logger injected):
  - sends once immediately, then every `TYPING_REFRESH_MS` (Discord's indicator
    lasts ~10 s);
  - skips a tick while the previous send is still in flight (no pile-up);
  - a failed send is a `warn`, never an error that reaches the reply path;
  - `stop()` clears the interval and waits for the in-flight send, capped at
    `STOP_WAIT_MS` so a hung REST call can never hold the reply back;
  - `stop()` is idempotent.
- `index.ts`: the indicator starts before the attachment download. The reply text is
  computed first, the indicator is stopped (in `finally`, so the throw path stops
  it too), and only then is the reply posted. Stopping *after* posting let a send
  that crossed the post land late and leave "typing…" up for ~10 s on an answered
  message (observed by the reporter).
- Existing branches (attachment-only failure, error reply, 2000-char split) keep
  their exact posting calls.

## Tests

`test/test_typing.ts` with fake timers: immediate send, refresh cadence, no send
after `stop()`, `stop()` waits for the in-flight send, `stop()` gives up after the
cap, rejected sends are logged and do not stop the loop, overlapping tick skipped,
double `stop()`.
