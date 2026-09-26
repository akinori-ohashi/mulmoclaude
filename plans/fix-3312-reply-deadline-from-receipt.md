# fix: count a bridge message's reply limit from receipt (#3312)

## Problem

`@mulmobridge/client` starts its ack timer (reply limit + one minute) when it
sends. The chat-service started the reply limit only when it began collecting
the agent's reply — after the turn reached the front of its chat's queue and
after state read / command handling / `startChat()`. A message queued behind a
long turn could therefore still be running when the client gave up, and its
reply was dropped.

## Decision

Count the limit from when `relay()` received the message (issue comment on #3312).

- `createRelay` records `receivedAtMs` and resolves `replyTimeoutMs` at receipt.
- When the turn starts, a message with no time left is answered with a
  "timed out before the agent could start" reply and never reaches the agent
  (checked just before `startChat()`, so commands still run).
- Otherwise the reply is collected for the remaining time only.
- Rule: `remainingReplyMs(receivedAtMs, replyTimeoutMs, nowMs)` in
  `packages/chat-service/src/reply-deadline.ts` (pure).

Chat-service only; no protocol or client change.

## Trade-off

A turn queued behind a long one gets less agent time; an expired one is not run.

## Out of scope

After a turn is cut off its agent keeps running, so the next turn's
`startChat()` gets 409 and is answered "please wait" — #3320.
