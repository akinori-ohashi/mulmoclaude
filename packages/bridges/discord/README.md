# @mulmobridge/discord

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Discord bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). The bot responds to messages in channels it has access to.

## Attachments

Files posted with a message are downloaded from Discord's CDN and forwarded to MulmoClaude, so you can paste a screenshot and ask about it. A post with **only** files and no text is forwarded too, with `Describe / analyze this file.` as the body.

- Up to 10 files per message, 8 MB each — anything larger is skipped and noted in the message MulmoClaude receives.
- Images and PDFs reach Claude directly; text, DOCX, XLSX and PPTX are converted server-side. Other types are skipped with a log line.
- Attachments arrive over the **Message Content Intent**, the same privileged intent the bot already needs to read text.

## Threads

A Discord thread is a **channel of its own** — it has its own id, separate from the channel it hangs off. That single fact drives both settings below.

> **Check the bot's permissions first.** Posting inside a thread needs `Send Messages in Threads`, which Discord treats as separate from `Send Messages`. Without it the bot receives thread messages and silently fails to reply. See [Setup](#3-invite-the-bot-to-your-server).

### The allowlist judges a thread by its parent channel

`DISCORD_ALLOWED_CHANNELS` used to compare a thread against its own id, and a thread's id is minted fresh every time someone opens one. So the allowlist and threads could not be used together: you had to paste each new thread's id into `.env` and restart, or leave the list empty and let the bot answer in every channel it can see.

Now a message in a thread is admitted when the **parent channel** is listed. Allow `#ai-help` once and every thread under it works, with the permitted area still closed at that channel. Listing a thread's own id also still works, so an existing `.env` keeps behaving as it did.

### `DISCORD_SESSION_GRANULARITY` — one session per thread, or per channel

> **What's a "session"?** In MulmoClaude a *session* is one continuous conversation — it remembers what you said earlier and builds on it. This setting decides how many sessions one Discord channel maps to.

#### 🧵 `thread` (default) — a thread is its own conversation

```text
#ai-help
├── Alice: "Summarize yesterday's standup"        → session: #ai-help
│
├── 🧵 Deploy question
│   ├── Bob: "What's the rollback procedure?"     ┐
│   └── Bob: "And who approves it?"               ┘ → its own session
│
└── 🧵 Translation task
    ├── Alice: "Translate the release notes"      ┐
    └── Alice: "Now make it shorter"              ┘ → its own session
```

Open a thread for each topic and the AI keeps them apart — Bob's deploy question never mixes into Alice's translation. Because a thread carries its own id, this is what the bridge has always done for threads that reached it; the default keeps that.

#### 🗂 `channel` — every thread joins its parent channel's conversation

```text
#ai-help
├── Alice: "Summarize yesterday's standup"        ┐
├── 🧵 Deploy question                            │
│   └── Bob: "What's the rollback procedure?"     ├ one session, keyed by #ai-help
└── 🧵 Translation task                           │
    └── Alice: "Translate the release notes"      ┘
```

Use this when threads are just a tidier way to lay out **one** running conversation and you want the AI to carry context across all of them. Watch out: a long-lived channel session accumulates context, so answers get slower and pull in stale details.

| | `thread` *(default)* | `channel` |
|---|---|---|
| Message in a channel | channel session | channel session |
| Message in a thread | **thread session** | **parent channel session** |
| Post in a **forum** channel | thread session | thread session |
| DM | one session per DM | one session per DM |

Notes:

- **A forum post never folds**, in either mode. Discord does not allow posting into a forum channel itself — you open a post — so a session keyed by the forum id would have nowhere to deliver a server-initiated message. A forum post is its own conversation anyway; there is no channel-level talk to fold it into. The forum id still works in `DISCORD_ALLOWED_CHANNELS`.
- **A thread never folds onto a parent your allowlist does not cover.** If you allow a thread by its own id — the older workaround — its parent channel is not thereby allowed, so `channel` mode keeps that thread's own session rather than aiming replies at a channel you chose to leave out. Both rules are the same invariant: a session is only ever keyed to a channel the bot may actually talk in.
- The value is case-insensitive. Anything other than `thread` or `channel` makes the bridge exit at startup rather than guess — including Slack's `auto`, which has no separate meaning here.
- The default differs from [`@mulmobridge/slack`](https://www.npmjs.com/package/@mulmobridge/slack), where `SLACK_SESSION_GRANULARITY` defaults to `channel`. A Slack thread is a facet of a channel; a Discord thread is a channel. Set both explicitly if you run the two bridges and want them to match.
- Switching modes does not delete anything. It only changes how *new* messages map to sessions — old conversations stay in the MulmoClaude UI, and the AI does not port their context into the new ones.

## Setup

### 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Name it (e.g. "MulmoClaude")

### 2. Create the Bot

1. **Bot** tab → **Add Bot**
2. Copy the **Token** (this is your `DISCORD_BOT_TOKEN`)
3. Enable **Message Content Intent** under Privileged Gateway Intents

### 3. Invite the bot to your server

**OAuth2** → **URL Generator**:
- Scopes: `bot`
- Permissions: `Send Messages`, `Send Messages in Threads`, `Read Message History`

`Send Messages in Threads` is a **separate** Discord permission from `Send Messages` — a bot granted only the latter receives messages posted in a thread and then fails to reply to them. Grant both, or the bot will look silent inside every thread. Already-invited bots do not pick up a new permission from a fresh invite URL alone; add it to the bot's role, or to the channel's permission overwrites.

Copy the generated URL and open it in your browser to invite the bot.

### 4. Run the bridge

```bash
# With mock server (testing)
npx @mulmobridge/mock-server &
DISCORD_BOT_TOKEN=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/discord

# With real MulmoClaude
DISCORD_BOT_TOKEN=... \
npx @mulmobridge/discord
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Developer Portal |
| `DISCORD_ALLOWED_CHANNELS` | No | CSV of channel IDs to restrict (empty = all). A thread is admitted by its **parent** channel, or by its own id — see [Threads](#threads) |
| `DISCORD_SESSION_GRANULARITY` | No | `thread` *(default)* \| `channel`. Whether a thread is its own session or joins its parent channel's. `channel` folds only onto a parent that is postable and allow-listed. See [Threads](#threads) |
| `MULMOCLAUDE_API_URL` | No | Default: auto (`.server-port`; waits if nothing is published) |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token (auto-read from workspace) |
| `DISCORD_BRIDGE_DEFAULT_ROLE` | No | Role id to seed new bridge sessions with (e.g. `coder`, `general`). Applied ONLY when a discord session first appears — once the user switches role via `/role <id>` the session's own role wins. Unknown role ids silently fall back to the server's default with a warn log. |
| `BRIDGE_DEFAULT_ROLE` | No | Same as above but shared across every bridge. Transport-specific `DISCORD_BRIDGE_DEFAULT_ROLE` wins when both are set. |

### Auth token persistence across server restarts

The MulmoClaude server regenerates a fresh bearer token on every startup and writes it to `<workspace>/.session-token` (`$MULMOCLAUDE_WORKSPACE_PATH`, or `~/mulmoclaude` when unset), alongside the port it bound in `.server-port`.

**The bridge follows a restart on its own.** When the connection fails it re-reads both files, and if the server came back as a different generation — new token, new port, or both — it rebuilds its socket against it (#3078). You do not have to restart the bridge.

Pinning the token is still useful when the bridge runs **on a different machine** from the server, where it cannot read the workspace at all: set `MULMOCLAUDE_AUTH_TOKEN` to the same long random value on both sides. The server then uses it verbatim instead of regenerating.

```bash
# Server (one-time setup — same value across restarts)
MULMOCLAUDE_AUTH_TOKEN=long-random-string yarn dev

# Bridge (separate process / machine — same value)
MULMOCLAUDE_AUTH_TOKEN=long-random-string \
  <bridge-specific-envs> \
  npx <this-package>@latest
```

Recommended: at least 32 characters of random data (the server logs a warning at startup for shorter values).

## Ecosystem

Part of the [`@mulmobridge/*`](https://www.npmjs.com/~mulmobridge) package family.

**Shared libraries:**

- [`@mulmobridge/client`](https://www.npmjs.com/package/@mulmobridge/client) — socket.io client library used by every bridge below
- [`@mulmobridge/protocol`](https://www.npmjs.com/package/@mulmobridge/protocol) — wire types and constants
- [`@mulmobridge/chat-service`](https://www.npmjs.com/package/@mulmobridge/chat-service) — server-side relay + session store
- [`@mulmobridge/relay`](https://www.npmjs.com/package/@mulmobridge/relay) — Cloudflare Workers webhook proxy
- [`@mulmobridge/mock-server`](https://www.npmjs.com/package/@mulmobridge/mock-server) — mock server for local bridge development

**Bridges** (one npm package per platform):

- [`@mulmobridge/bluesky`](https://www.npmjs.com/package/@mulmobridge/bluesky) — Bluesky DMs over atproto
- [`@mulmobridge/chatwork`](https://www.npmjs.com/package/@mulmobridge/chatwork) — Chatwork (Japanese business chat)
- [`@mulmobridge/cli`](https://www.npmjs.com/package/@mulmobridge/cli) — interactive terminal bridge
- [`@mulmobridge/discord`](https://www.npmjs.com/package/@mulmobridge/discord) — Discord bot via Gateway  ← **this package**
- [`@mulmobridge/email`](https://www.npmjs.com/package/@mulmobridge/email) — IMAP poll + SMTP reply, threading preserved
- [`@mulmobridge/google-chat`](https://www.npmjs.com/package/@mulmobridge/google-chat) — Google Chat via MulmoBridge relay
- [`@mulmobridge/irc`](https://www.npmjs.com/package/@mulmobridge/irc) — IRC (Libera, Freenode, custom)
- [`@mulmobridge/line`](https://www.npmjs.com/package/@mulmobridge/line) — LINE Messaging API via MulmoBridge relay
- [`@mulmobridge/line-works`](https://www.npmjs.com/package/@mulmobridge/line-works) — LINE Works (enterprise LINE)
- [`@mulmobridge/mastodon`](https://www.npmjs.com/package/@mulmobridge/mastodon) — Mastodon DMs + mentions
- [`@mulmobridge/matrix`](https://www.npmjs.com/package/@mulmobridge/matrix) — Matrix / Element
- [`@mulmobridge/mattermost`](https://www.npmjs.com/package/@mulmobridge/mattermost) — Mattermost
- [`@mulmobridge/messenger`](https://www.npmjs.com/package/@mulmobridge/messenger) — Facebook Messenger via MulmoBridge relay
- [`@mulmobridge/nostr`](https://www.npmjs.com/package/@mulmobridge/nostr) — Nostr NIP-04 encrypted DMs
- [`@mulmobridge/rocketchat`](https://www.npmjs.com/package/@mulmobridge/rocketchat) — Rocket.Chat
- [`@mulmobridge/signal`](https://www.npmjs.com/package/@mulmobridge/signal) — Signal via signal-cli-rest-api
- [`@mulmobridge/slack`](https://www.npmjs.com/package/@mulmobridge/slack) — Slack Socket Mode
- [`@mulmobridge/teams`](https://www.npmjs.com/package/@mulmobridge/teams) — Microsoft Teams via Bot Framework
- [`@mulmobridge/telegram`](https://www.npmjs.com/package/@mulmobridge/telegram) — Telegram bot
- [`@mulmobridge/twilio-sms`](https://www.npmjs.com/package/@mulmobridge/twilio-sms) — SMS via Twilio Programmable Messaging
- [`@mulmobridge/viber`](https://www.npmjs.com/package/@mulmobridge/viber) — Viber Public Account bots
- [`@mulmobridge/webhook`](https://www.npmjs.com/package/@mulmobridge/webhook) — generic HTTP webhook bridge
- [`@mulmobridge/whatsapp`](https://www.npmjs.com/package/@mulmobridge/whatsapp) — WhatsApp Cloud API via MulmoBridge relay
- [`@mulmobridge/xmpp`](https://www.npmjs.com/package/@mulmobridge/xmpp) — XMPP / Jabber
- [`@mulmobridge/zulip`](https://www.npmjs.com/package/@mulmobridge/zulip) — Zulip

## Related projects

Published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.

## License

MIT
