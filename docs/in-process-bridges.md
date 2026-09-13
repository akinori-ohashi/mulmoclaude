# In-process bridges

A chat bridge normally runs as its own process (`yarn telegram`), which means
restarting the server means restarting the bridge by hand. Enable it in
`config/bridges.json` instead and the server starts it inside its own process
(#3080).

## Enabling one

```jsonc
// <workspace>/config/bridges.json
{
  "bridges": {
    "telegram": { "enabled": true },
  },
}
```

Credentials stay where they already are — `.env` — because that file is already
excluded from backups and git. Only the on/off switch lives in the JSON.

```bash
# .env, unchanged from the CLI setup
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_IDS=12345678
```

Restart the server. It logs `bridges  in-process bridges running` with the list.

## What it changes

|                            | `yarn telegram` | `config/bridges.json`                       |
| -------------------------- | --------------- | ------------------------------------------- |
| starts with the server     | no              | **yes**                                     |
| separate process           | yes             | no                                          |
| needs `.server-port`/token | yes             | **no** — it calls the chat service directly |
| survives a server restart  | you restart it  | restarts with it                            |

The port and token are not needed because an in-process bridge never makes an
HTTP round trip: it calls the same `RelayFn` that the HTTP router and the
socket.io transport call. That also means #3078 (a bridge losing track of the
server's port) cannot happen on this route.

## When a bridge fails to start

**The server still starts.** A missing token, a malformed allowlist, a bridge
package that is not installed — each costs that one bridge and is written to the
log, matching how the Relay client skips when its env is absent:

```
bridges  bridge failed to start — the server continues without it
         { transportId: 'telegram', error: 'TELEGRAM_BOT_TOKEN is required. …' }
```

A malformed entry in `config/bridges.json` is reported the same way rather than
skipped silently, because a typo'd transport id that vanishes looks exactly like
a bridge the server decided not to start.

## Which bridges can do this

`telegram` today. The other 24 under `packages/bridges/` still need their
`index.ts` split into a library half, which #3080 does in follow-up PRs. Enabling
one before it is converted logs:

```
bridges  enabled bridge cannot run in-process yet — start it with its CLI instead
```

The CLI keeps working for every bridge, converted or not, and behaves exactly as
it did before — same messages, same exit codes.

## Running the same bridge both ways

Don't. Two bridges claiming one transport id is what #3079 is about; the
registry refuses a second in-process registration for a transport id that
already has one.
