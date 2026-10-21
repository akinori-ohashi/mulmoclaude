# feat(line): group / multi-person chat support (#3567)

## Goal

A LINE bot added to a group (or a multi-person room) holds ONE conversation per group,
replies into the group, and by default answers only when it is mentioned.

## Invariants (what must NOT change)

- **One-on-one chats are untouched.** The conversation key stays the raw `userId` (no
  prefix) — chat-service stores state at `transports/line/chats/<chatId>.json`, so a
  prefix would orphan every existing session. Push target, loading animation, image
  handling: all unchanged for `source.type === "user"` (and for a source with a `userId`
  but no `type`, which the bridge accepted before).
- **No event LINE sends is newly dropped.** `groupId` / `roomId` are checked only when
  present (string, like the other source fields); a malformed `mention` reads as "not mentioned"
  instead of rejecting the event.
- Id namespaces don't collide: LINE `userId` = `U…`, `groupId` = `C…`, `roomId` = `R…`.

## Behaviour change (accepted)

Today a group message with a `userId` is answered in the speaker's 1:1 chat and shares
their 1:1 session. After this change it goes to the group's own session and the reply is
pushed to the group. Released as a minor (1.3.0) via `/publish`; the README calls out the change.

## Design

1. `parse.ts` — `extractIncomingLineMessage` returns `chatId` + `chatType`
   (`user` | `group` | `room`) + `mentionsBot`. Key: `group` → `groupId`,
   `room` → `roomId`, otherwise `userId`. A group message without `userId`
   (sender not a friend of the bot) is kept.
2. `mention.ts` (pure) — `mentionsBot(mention)` from `mentionees[].isSelf`;
   `stripSelfMentions(text, mention)` removes the bot's own mention ranges
   (`index` / `length`, UTF-16 like JS strings) and trims.
3. `config.ts` (pure) — `parseRequireMention(raw)`: unset / `1` / `true` → on,
   `0` / `false` → off, anything else throws (bridge exits, Discord/Slack pattern).
4. `respond.ts` (pure) — `shouldRespond(incoming, requireMention)`: 1:1 always;
   group/room only when mentioned unless the gate is off. Images can't carry a
   mention, so with the gate on they're ignored in groups.
5. `index.ts` — `client.send(incoming.chatId, …)` and `pushMessage(incoming.chatId, …)`.
   Loading stays 1:1 only (`loading.ts` unchanged, now keyed by `chatId`, which equals
   `userId` there).

## Tests

- 1:1 key is byte-identical to the old `userId` key across generated ids.
- group / room / missing-userId-in-group / unknown type.
- mention detection: isSelf true / false / absent / malformed; `@All` doesn't count.
- strip: single, multiple, out-of-range, mention-only text → dropped.
- env parse both directions; `shouldRespond` matrix.
