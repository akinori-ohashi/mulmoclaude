# Claude ↔ Docker sandbox: what runs where

When MulmoClaude spawns `claude -p` for an agent turn, the CLI runs
inside the Docker sandbox but **most of its power lives on the host**.
This doc walks through the split so you can predict where a given tool
call actually executes — useful when debugging permission errors,
missing binaries in `Bash`, or an MCP tool that "works locally but not
in Docker".

If `DISABLE_SANDBOX=1` is set (or Docker isn't running), every row in
the table below collapses to "host" — the sandbox layer is skipped and
`claude` runs directly on the host with full access.

## Claude built-in tools (Bash / Read / Write / Edit / Grep / Glob …)

**Container.** Claude Code implements these itself; the process is
whatever `docker run` started, so the tool executes inside the
sandbox. Implications:

- `Bash` sees only the binaries in the `node:22-slim` sandbox image
  — no `git`, `python`, `jq`, or arbitrary system tools by default
  ([#162](https://github.com/receptron/mulmoclaude/issues/162),
  [`docs/mcp-sandbox.md`](mcp-sandbox.md)).
- File I/O uses the workspace bind mount: `~/mulmoclaude/` on the host
  shows up as `/home/node/mulmoclaude/` in the container, so writes
  land on real host files but `Read`/`Write` cannot see anything
  outside the mounted paths.
- Host credentials (SSH keys, `.aws`, npm auth …) are **not** visible
  from `Bash` unless you've explicitly opted them in via
  `SANDBOX_SSH_AGENT_FORWARD` or `SANDBOX_MOUNT_CONFIGS`
  ([`docs/sandbox-credentials.md`](sandbox-credentials.md)).

## MCP — the two-tier arrangement

Claude thinks it's calling a local MCP tool. In practice the tool's
**stdio subprocess** lives in the container but its **actual
implementation** lives on the host. The container-side piece is a
thin proxy.

### mulmoclaude built-in MCP (`server/agent/mcp-server.ts`)

1. Claude reads `--mcp-config` and starts `tsx /app/server/agent/mcp-server.ts`
   as a subprocess **in the container**
   (`buildMulmoclaudeServer` in `server/agent/config.ts:276`).
2. The bridge subprocess talks JSON-RPC over stdio with Claude.
3. For every tool call, the bridge issues an **HTTP request to
   `MCP_HOST=host.docker.internal:PORT/api/…`** — i.e. back to the
   host's Express server (`config.ts:284`).
4. The **real tool logic runs on the host** — file writes to the
   workspace, plugin dispatch, DB queries, external API calls, other
   MCP tools' side effects. The container-side bridge just forwards.

Net effect: Claude gets the full power of the host through a
stdio-shaped hole. This is the "bypass" people describe.

### User-defined MCP (added in the Settings UI)

| Kind | Docker-mode routing |
|---|---|
| **HTTP** | URL rewritten so `localhost` → `host.docker.internal` (`rewriteLocalhostForDocker` in `config.ts:116`). Claude in the container connects over HTTP; the server itself runs on the **host** where the user configured it. |
| **stdio** (default) | **Dropped.** The `node:22-slim` sandbox image can't host arbitrary stdio runtimes ([#162](https://github.com/receptron/mulmoclaude/issues/162), [#1334](https://github.com/receptron/mulmoclaude/issues/1334)). The Settings UI surfaces this before you save. |
| **stdio + `hostExecInDocker: true`** ([#1421 Phase B](https://github.com/receptron/mulmoclaude/issues/1421)) | Explicit opt-in. MulmoClaude starts the stdio server on the **host** behind a `stdio ↔ HTTP` gateway and rewrites the config to `http` so the sandboxed Claude can reach it (`config.ts:186`). |

## Claude Code plugins (`/plugin install`)

**Container**, from the host's own `~/.claude` bind mount — but only because
the ledgers get translated on the way in.

The CLI records where each marketplace and each plugin lives as an absolute
path on the machine that installed them:

| file | key |
|---|---|
| `<claudeConfigDir>/plugins/known_marketplaces.json` | `installLocation` |
| `<claudeConfigDir>/plugins/installed_plugins.json` | `installPath` |

Those are HOST paths (`/Users/you/.claude/...`) pointing into whatever
`claudeConfigDir()` resolves to — `~/.claude`, or the directory
`CLAUDE_CONFIG_DIR` names when it is set, which is the same source
`dockerBindMountArgs` bind-mounts. The container's `HOME` is `/home/node`, so
read verbatim they are ENOENT. The CLI answers `cache-miss`
for the marketplace and the plugin goes with it — **every surface at once**:
skills, slash commands, MCP servers and hooks, with no error and no warning
([#3186](https://github.com/receptron/mulmoclaude/issues/3186)).

`pluginLedgerMountArgs` (`server/agent/pluginLedgerMount.ts`) stages
container-shaped copies of both files and overlays them read-only, the same idea
as `localhost` → `host.docker.internal` for HTTP MCP. The translation itself is
pure and lives in `server/agent/pluginLedgerPaths.ts`.

Two things to know when debugging this:

- **`claude plugin list` is not the success signal.** It can report `enabled`
  while the agent still receives nothing. Read the `init` event of
  `claude -p --output-format stream-json --verbose` instead: it carries the
  session's slash commands, tools and `mcp_servers`.
- **A plugin registered from OUTSIDE the config dir is mounted too** (#3198).
  `plugin marketplace add <local path>` is the plugin author's ordinary
  workflow, and that tree is carried by no other mount — so it gets its own,
  read-only, at `/mnt/plugin-src/<name>-<hash>`, and the ledger is translated to
  point there. The path must pass the same blocklist reference directories use
  (`server/utils/sensitiveMountPaths.ts`): `$HOME` itself, `.ssh`, `.aws`,
  `.gnupg`, `.config/gh`, `.kube`, `.docker`, the system directories and the
  filesystem root are refused whatever the ledger says, and such an entry is
  left untranslated rather than mounted.

## How a host path becomes a mount argument

Every bind mount the sandbox builds goes through `server/agent/dockerMount.ts`,
which exists because two things about host paths are easy to get wrong (#3191):

- **The separator conversion is a Windows rule.** Docker wants `/` and a Windows
  path spells them `\`. On POSIX a backslash is an ordinary filename character,
  so converting there hands Docker a path that does not exist — and Docker
  answers that by creating an empty directory and mounting *that*, silently. A
  workspace with a backslash in its path used to appear empty to the agent while
  its writes went to a phantom directory on the host.
- **`-v` and `--mount` are complementary, not ranked.** `-v` splits its fields on
  `:`; `--mount` parses one CSV record, so it cannot carry `,`, a bare `"`, or a
  control character. Neither can express every path.

So `-v` stays the default — every path that worked before keeps the argument it
had — and `--mount` is used only when a colon rules `-v` out. A path neither can
express is refused, and what that costs depends on the mount: a **skippable** one
(reference directory, `gh`/`gitconfig`, SSH socket, plugin ledgers) is dropped
with a warning and the sandbox still runs, while an **essential** one (workspace,
`~/.claude`, the app's own code) raises `UnmountablePathError` naming the path,
rather than letting Docker reject a spec the user never wrote.

On Windows the drive letter is a colon Docker understands, and it deliberately
does not count — otherwise every Windows mount would switch flags.

**A dropped mount must also disappear from everything that claims it is there.**
Three surfaces say what is attached — the docker argv, the startup log and
`GET /api/sandbox` — and the system prompt tells the agent which reference
directories it may read. They all derive from the same lists, so a skip has to
reach every one of them or they start lying in the user's favour: `#3193` fixed
the first three (`planConfigMounts`) and `#3194` the fourth (`planReferenceDirs`).
The prompt is the one that matters most, because it misleads the **agent**, which
acts on it, rather than a human who can go and look.

## Where-what summary

| What | Where it runs |
|---|---|
| `claude -p` CLI itself | **container** |
| Claude built-in `Bash` / `Read` / `Write` / `Edit` / `Grep` / `Glob` | **container** |
| mulmoclaude MCP stdio subprocess (bridge proxy) | container |
| mulmoclaude MCP tool **implementation** | **host** (Express) |
| User HTTP MCP | **host** (URL rewritten to reach it) |
| User stdio MCP (default) | *not called* |
| User stdio MCP (`hostExecInDocker: true`) | **host** (via stdio↔HTTP gateway) |
| Claude Code plugins (skills / commands / hooks) | **container** (ledgers translated) |
| A plugin's own MCP server | **container** (spawned from the mounted plugin tree) |
| Anthropic API traffic | container (outbound directly) |

## Consequences

- Host secrets (`git` config, `npm` token, `~/.aws`, SSH keys, …) are
  **safe from `Bash`** by default. Escape hatches are explicit env
  vars documented in [`sandbox-credentials.md`](sandbox-credentials.md).
- The workspace is writable, because the bind mount is `rw`. Files
  Claude writes appear on the host under `~/mulmoclaude/`.
- MCP is the **intended** channel for exposing host capabilities to
  the agent. If you want Claude to reach a host service, expose it as
  an HTTP MCP (auto-rewritten) or add a tool to the mulmoclaude
  broker.
- `DISABLE_SANDBOX=1` collapses everything to the host — useful for
  debugging without a container rebuild, but Claude then has host-wide
  authority through `Bash`.

## Related

- [`docs/developer.md#docker-sandbox`](developer.md#docker-sandbox-dockerfilesandbox)
  — bind mounts, image build, path translation
- [`docs/developer.md#container-only-env-auto-set`](developer.md#container-only-env-auto-set)
  — env vars auto-set inside the container
- [`docs/mcp-sandbox.md`](mcp-sandbox.md) — TL;DR of the stdio-vs-HTTP
  MCP situation
- [`docs/sandbox-credentials.md`](sandbox-credentials.md) — SSH agent
  forward + `SANDBOX_MOUNT_CONFIGS` allowlist
