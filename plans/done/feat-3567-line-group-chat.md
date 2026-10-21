# feat(line): group / multi-person chat support (#3567)

Shipped in PR #3569, released as `@mulmobridge/line@1.3.0` (PR #3571).

## Goal

A LINE bot added to a group (or a multi-person room) holds ONE conversation per group,
replies into the group, and by default answers only when it is mentioned.

## Invariants (what must NOT change)

- **One-on-one chats are untouched.** The conversation key stays the raw `userId` (no
  prefix) — chat-service stores state at `transports/line/chats/<chatId>.json`, so a
  prefix would orphan every existing session. Push target, loading animation, image
  handling and text: all unchanged for a one-on-one source (`type: "user"`, an unknown
  type, or a `userId` with no `type`) — including when such an event carries a `mention`,
  which is read only in groups / rooms.
- **No event the old parser accepted is dropped unless it is a group / room event.**
  `groupId` is type-checked only when `type: "group"`, `roomId` only when `type: "room"`;
  an unrelated extra field on any other source is left alone. A malformed `mention` reads
  as "not mentioned" instead of rejecting the event.
- Id namespaces don't collide: LINE `userId` = `U…`, `groupId` = `C…`, `roomId` = `R…`.

## Behaviour change (accepted)

Today a group message with a `userId` is answered in the speaker's 1:1 chat and shares
their 1:1 session. After this change it goes to the group's own session and the reply is
pushed to the group. Released as a minor (1.3.0); the README and the changelog call out the change.

## Design

1. `parse.ts` — `resolveLineChat(source)` gives `chatId` + `chatType` (`user` | `group` |
   `room`): `group` → `groupId`, `room` → `roomId`, otherwise `userId`. A group / room
   source without its id is dropped rather than answered elsewhere; a group message
   without `userId` (sender not a friend of the bot) is kept. `extractIncomingLineMessage`
   adds `mentionsBot`; one-on-one text is passed on verbatim, images are never mentioned.
2. `mention.ts` (pure) — `selfMentionRanges(text, mention)` returns the bot's own
   mentions (`isSelf === true`, integer `index` / `length`, inside the text; UTF-16 like
   JS strings). The gate and `stripMentionRanges(text, ranges)` both use it, so they always
   agree on what counts as a mention.
3. `groupGate.ts` (pure) — `parseRequireMention(raw)`: unset / `1` / `true` → on,
   `0` / `false` → off, anything else throws (the bridge exits, Discord/Slack pattern).
   `shouldRespond(incoming, requireMention)`: one-on-one always; group / room only when
   mentioned unless the gate is off.
4. `deliver.ts` — `deliverLineEvent(event, deps)`: gate → loading (one-on-one only, via
   `loadingSenderFor(event.source, …)`) → `send(chatId, …)` → `push(chatId, …)`. Every LINE
   and MulmoClaude call is injected, so the routing is testable without a server.
5. `index.ts` — wires the real client, `pushMessage`, `startLineLoading` and the image
   download into `deliverLineEvent`, and parses the env var at startup.

## Tests

- One-on-one: the key is the raw `userId` and the text is verbatim, across generated ids,
  texts, source shapes and mention payloads (`test_parse.ts`).
- Group / room keys, missing ids, a sender without `userId`, mention-only text, malformed
  and out-of-range mentions, unrelated non-string source fields.
- `test_mention.ts`: self / other / `@All` / malformed / out-of-range; stripping single,
  several, overlapping, UTF-16.
- `test_groupGate.ts`: env parsing both directions; the `shouldRespond` matrix.
- `test_deliver.ts`: what is loaded, sent and pushed, to which id, for one-on-one text and
  image, group with / without mention, room, group image, gate off, and a failing send.
