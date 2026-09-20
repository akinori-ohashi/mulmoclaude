# plan: Discord thread-scoped sessions + parent-channel allowlist

Tracking: #3217

## Goal

Two independent changes to `@mulmobridge/discord`, both about Discord
threads:

1. **The allowlist judges a thread by its parent text channel.** Today a
   thread is rejected unless its own id is in `DISCORD_ALLOWED_CHANNELS`,
   and a thread's id is new every time someone opens one — so the
   allowlist and threads cannot be used together without editing `.env`
   and restarting.
2. **`DISCORD_SESSION_GRANULARITY` decides whether a thread gets its own
   session or joins its parent channel's.**

## Why Discord is not Slack here

A Slack thread is a facet of a channel (`channel` + `thread_ts`). A
**Discord thread is a channel** — it has its own snowflake, and
`msg.channelId` already _is_ the thread id. So the bridge needs no
composite id, no `parseExternalChatId`, and no push-path change: the
server hands back whatever id it was given and `channels.fetch()`
resolves a thread by id exactly as it resolves a text channel.

That asymmetry also decides the default (below) and means Slack's
`auto` mode has no distinct meaning here — for Discord it would be a
second spelling of `thread`, so only `channel` and `thread` exist.

## The `parentId` trap

`parentId` means two different things depending on the channel class:

| Class                                       | `parentId`                        |
| ------------------------------------------- | --------------------------------- |
| `ThreadChannel` (`typings/index.d.ts:3962`) | the parent **text/forum channel** |
| `GuildChannel` (`typings/index.d.ts:1826`)  | the parent **category**           |

So reading `msg.channel.parentId` without an `isThread()` gate would
match a regular channel's _category_ id against the allowlist — a
silent allowlist failure in both directions. The gate lives inside the
pure helper so a test pins it.

## Env var

`DISCORD_SESSION_GRANULARITY` — case-insensitive, validated at startup.

| Value                | Message in a thread                        | Message not in a thread         |
| -------------------- | ------------------------------------------ | ------------------------------- |
| `thread` _(default)_ | session keyed by the **thread** id         | session keyed by the channel id |
| `channel`            | session keyed by the **parent channel** id | session keyed by the channel id |

An unset var means `thread`. An explicitly invalid value exits non-zero
rather than falling back, matching `parseGranularity` in the Slack
bridge.

### Why `thread` is the default, unlike Slack

#3217 proposes `channel` as the default and calls it behaviour-
preserving. It is not. Today `mulmo.send(msg.channelId, …)` passes the
thread id verbatim, so **every thread that reaches the bridge already
gets its own session** — which happens whenever the allowlist is empty,
and whenever an operator used the documented workaround of pasting a
thread id into `DISCORD_ALLOWED_CHANNELS`. Defaulting to `channel`
would merge those live sessions into their parent.

`thread` as the default leaves every one of today's paths alone and
makes `channel` the opt-in for "fold threads into the channel
conversation". It diverges from `SLACK_SESSION_GRANULARITY`'s default,
which the README says out loud.

## Shape

New `src/sessionId.ts`, pure and dependency-free so `test/` can import
it without `src/index.ts` opening a Gateway connection on load:

```ts
export type SessionGranularity = "channel" | "thread";
export interface MessageChannelRef {
  channelId: string;
  parentChannelId?: string;
}

export function parseGranularity(raw: string | undefined): SessionGranularity;
export function readChannelRef(channelId: string, channel: ChannelLike): MessageChannelRef;
export function isChannelAllowed(ref: MessageChannelRef, allowed: ReadonlySet<string>): boolean;
export function buildExternalChatId(ref: MessageChannelRef, mode: SessionGranularity): string;
```

`isChannelAllowed` admits a message when the allowlist is empty, when it
holds the channel's own id, **or** when it holds the parent channel id.
Accepting the own-id case keeps the thread-id-in-`.env` workaround
working — it is what happens today, so dropping it would be a
regression dressed as a cleanup.

`src/index.ts` keeps the ordering it has: the allow check still runs
before any attachment is fetched, so a denied thread never makes the
bridge download anything.

## Tests

`test/test_sessionId.ts`, `node:test` + `node:assert/strict`, covering
both directions per CLAUDE.md:

- `parseGranularity`: unset, both values, case-insensitivity, unknown
  value, empty string, surrounding whitespace.
- `readChannelRef`: thread with a parent, thread with a null parent
  (defensive), non-thread channel **whose `parentId` is a category id**
  — the regression test for the trap above — and a DM-shaped channel
  with no `parentId` property at all.
- `isChannelAllowed`: empty allowlist, parent listed, own thread id
  listed, neither listed, non-thread channel allowed/denied, and that a
  non-thread channel is never admitted by its category id.
- `buildExternalChatId`: both modes × in-thread / not-in-thread.

## Docs

- `README.md` — a `Session granularity` section and a row in the env
  table; note in the allowlist row that a thread is judged by its
  parent.
- The env-var header comment at the top of `src/index.ts`.
- `docs/CHANGELOG.md` under `[Unreleased]`.

## Not in scope

- Auto-creating a thread from a top-level post (Slack's `thread` mode
  does this; #3217 does not ask for it).
- Allow-checking the push path — `onPushEvent` does not consult the
  allowlist today and that is unchanged.
- The npm version bump, which belongs to the publish flow.
