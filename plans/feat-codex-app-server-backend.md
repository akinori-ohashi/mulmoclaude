# feat: Codex App Server backend

## Status

Milestone A implemented. Milestone B remains partially complete: Settings/launcher/locales and explicit skill invocation are included; interactive approvals, provider-neutral one-shot jobs, Codex-aware wiki publishing, and guarded live E2E remain follow-up work.

## Goal

MulmoClaude の会話 backend として Claude Code に加えて OpenAI Codex を選択できるようにする。

最終状態では `codex` backend を選んだ利用者は Claude CLI をインストールしていなくても、通常チャット、会話再開、MulmoClaude MCP tools、attachments、skills、停止、background summarization を利用できる。

既存利用者の既定動作は変えない。Claude Code backend、現在の Docker sandbox、既存 session の読み込みを後方互換で維持する。

## Decision summary

- Codex integration は `codex exec` や現行 TypeScript SDK ではなく、stdio の `codex app-server` JSON-RPC v2 protocol を使う。
- 最初は現在の Claude CLI と同様に **agent turn ごとに app-server process を起動**し、Codex thread id で `thread/resume` する。常駐 process の multiplex は計測で必要性が判明するまで行わない。
- MulmoClaude の system prompt は `thread/start` / `thread/resume` の `developerInstructions` として渡す。`baseInstructions` は Codex 自身の tool/safety instructions を消し得るため置換しない。
- Codex は MulmoClaude の Claude 用 Docker image に入れない。ホストで起動し、Codex native sandbox の `workspaceWrite` を使う。
- MVP は `approvalPolicy: "never"` と `workspaceWrite` で headless に停止しない安全な動作にする。app-server から予期せず approval/user-input request が来た場合は deny/cancel して turn を解放する。対話的 approval UI は後続 PR で追加する。
- model は初期版では指定せず、利用者の Codex config/default model に従う。MulmoClaude が model id を固定しない。
- session token は provider 名を伴う generic metadata に変更する。Claude の `claudeSessionId` は読み込み互換を残す。

### Why App Server

MulmoClaude は一回限りの CLI pipeline ではなく rich client である。App Server は thread start/resume、turn streaming、command/file/MCP items、approval requests、images、skills、interrupt を同じ bidirectional protocol で提供する。これは現在の `LLMBackend.runAgent(): AsyncIterable<AgentEvent>` seam と対応し、将来 approval UI を実装する際にも backend を再交換せずに済む。

`@openai/codex-sdk` は `codex exec` の薄い wrapper で、system/developer instructions、approval protocol、skills/plugin lifecycle の surface が不足しているため、この用途の基盤にはしない。

## Current state

- `server/agent/backend/types.ts`、`index.ts`、`claude-code.ts` に backend seam がすでにある。
- portable `AgentEvent` と frontend SSE は Anthropic SDK type に依存していない。
- MulmoClaude MCP config と system prompt は orchestrator が turn ごとに組み立てている。
- 一方、次の箇所はまだ Claude 固有である。
  - backend factory は常に Claude を返す。
  - `claudeSessionId` が session meta、route、retry policy、event 名に残っている。
  - `isDockerAvailable()` と server startup が Claude config/credentials を前提にする。
  - launcher preflight は常に `claude` binary を要求する。
  - skills は `.claude/skills/` に mirror され、`/skill-name` を Claude CLI に解決させる。
  - journal、chat index、translation の one-shot LLM calls が `claudeBinPath()` を直接使う。
  - wiki snapshot/page-edit hook は Claude Code hook lifecycle を前提にする。

## Scope and milestones

### Milestone A — usable Codex chat backend

- backend selection
- Codex binary/auth preflight
- new thread and resume
- streaming assistant text
- command, file-change, and MCP tool event mapping
- MulmoClaude MCP tools and user MCP servers
- local image input and file markers
- stop/abort
- stale Codex thread recovery
- Codex native sandbox

### Milestone B — Codex-only feature parity

- skill discovery and explicit skill invocation
- interactive command/file approvals
- Codex-aware wiki file-change publishing
- journal, memory, chat-index, and translation one-shot calls
- launcher, Settings UI, help, README, and all locales
- guarded live E2E suite

## Architecture

### Turn lifecycle

1. Resolve the selected backend before any Docker/credential work.
2. Build the backend-neutral system prompt, active plugin list, attachments, and MCP specs.
3. Spawn `codex app-server` with stdio pipes and no shell.
4. Send `initialize`, then `initialized`.
5. Send `thread/start` when no Codex token exists, otherwise `thread/resume`.
   - `cwd`: MulmoClaude workspace
   - `developerInstructions`: MulmoClaude system prompt
   - `approvalPolicy`: `never` for MVP
   - `sandbox`: `workspaceWrite`
   - `serviceName`: `mulmoclaude`
   - `config`: translated per-turn MCP config
6. Persist the returned Codex thread id as `{ backendId: "codex", token }`.
7. Send `turn/start` with text and any `localImage` inputs.
8. Translate app-server notifications into `AgentEvent` until `turn/completed`.
9. On stop, send `turn/interrupt`; after a bounded grace period terminate the child.
10. Unsubscribe/close stdin and reap the process in `finally` on every path.

### Event mapping

| Codex app-server event/item                    | MulmoClaude event                              |
| ---------------------------------------------- | ---------------------------------------------- |
| `item/agentMessage/delta`                      | `text` chunk                                   |
| completed `agentMessage` without prior deltas  | `text`                                         |
| started `commandExecution`                     | `tool_call` (`shell_command`)                  |
| completed `commandExecution`                   | `tool_call_result` with output and error state |
| started `fileChange`                           | `tool_call` (`apply_patch`)                    |
| completed `fileChange`                         | `tool_call_result`                             |
| started `mcpToolCall`                          | `tool_call` named `mcp__<server>__<tool>`      |
| completed `mcpToolCall`                        | `tool_call_result`                             |
| `turn/completed` with failed status or `error` | `error`                                        |
| thread start/resume response                   | internal generic session-token event           |

The mapper must deduplicate final `agentMessage` content after deltas, just as the Claude stream parser currently does. Reasoning text is not persisted as assistant text; readable progress may become transient `status` events.

### MCP translation

Keep `config/mcp.json` and MulmoClaude's internal `buildMcpConfig()` as the user-facing source of truth. Add a pure translator from the existing Claude-shaped specs to Codex config overrides.

- stdio: `command`, `args`, `env`, timeouts; omit Claude-only `type` and `alwaysLoad`.
- HTTP: `url`; translate literal headers to the supported Codex header form.
- Preserve the reserved `mulmoclaude` server and role-filtered `PLUGIN_NAMES`.
- Pass the translated config through `thread/start` / `thread/resume` `config`, not command-line `--config` arguments. Tokens and header values must never appear in argv or logs.
- Treat config/protocol warnings as actionable startup errors when the MulmoClaude broker cannot load.
- Keep user stdio MCP servers on the host in Codex mode and document that boundary.

The exact override shape must be pinned by generated app-server TypeScript/JSON schema from the minimum supported Codex CLI and a real smoke test. Do not hand-maintain a broad copy of the full experimental protocol.

### Sandbox ownership

Extend backend capabilities so the orchestrator knows who owns sandboxing, for example:

```ts
interface BackendCapabilities {
  sessionResume: boolean;
  mcp: boolean;
  sandboxOwner: "mulmoclaude-docker" | "backend" | "none";
}
```

- Claude: `mulmoclaude-docker`
- Codex: `backend`
- fake echo: `none`

`isDockerAvailable()`, Claude credential refresh, and Docker image setup must only execute for the Claude backend. This also prevents Codex turns from receiving `/home/node/mulmoclaude` paths while the process actually runs on the host.

The status UI must report the effective sandbox by backend rather than equating all sandboxing with Docker.

### Session ownership and backend switching

Add a provider-tagged session reference:

```ts
interface AgentSessionRef {
  backendId: "claude-code" | "codex";
  token: string;
}
```

- Store it in `SessionMeta.agentSession`.
- Read legacy `claudeSessionId` as a Claude session ref.
- Never pass a token to a different backend.
- A backend change for an existing MulmoClaude chat starts a new provider thread and prepends the local transcript once, rather than attempting cross-provider resume.
- Generalize stale-session recovery to a typed backend error/recovery reason; do not detect Codex failures with Claude stderr regexes.
- Keep legacy metadata until a later cleanup release has shipped migration coverage.

## Delivery plan

### PR 1 — provider-neutral plumbing

1. Add `AgentBackendId`, backend registry/resolver, and `sandboxOwner` capability.
2. Add workspace setting `agentBackend: "auto" | "claude-code" | "codex"` with default `codex`; keep explicit `auto` mode resolving to Claude first for backward compatibility.
3. Add optional startup override `MULMOCLAUDE_AGENT_BACKEND` / `--agent-backend` for headless launch and tests.
4. Select the backend before Docker setup and credential checks.
5. Add `AgentSessionRef` persistence with legacy `claudeSessionId` reads.
6. Make recovery events provider-neutral while leaving Claude retry behavior unchanged.
7. Update settings validators, diagnostics allowlists, CLI flag registry, and unit tests.

### PR 2 — App Server client and Codex adapter

Add focused modules rather than one large adapter:

- `server/utils/codexBin.ts` — cross-platform executable resolution and actionable not-found error.
- `server/agent/backend/codex/protocol.ts` — narrow stable request/response/item types.
- `server/agent/backend/codex/client.ts` — JSONL request ids, pending response map, server requests, shutdown.
- `server/agent/backend/codex/mcpConfig.ts` — pure MCP translation with secret-redaction tests.
- `server/agent/backend/codex/eventMapper.ts` — stateful portable event mapping/deduplication.
- `server/agent/backend/codex-app-server.ts` — `LLMBackend` lifecycle adapter.

Implementation requirements:

1. No `shell: true`; pass argv as an array.
2. Bound initialize, interrupt, and shutdown waits with constants from `server/utils/time.ts`.
3. Attach child `error`, `close`, stdout, and stderr handlers before writing stdin.
4. Reject malformed JSON-RPC responses without crashing the server.
5. Redact prompts, auth, MCP env, and headers from logs.
6. Check protocol capability/version at startup and return a localized upgrade hint for an incompatible CLI.
7. Convert image attachments with workspace paths to absolute `localImage` items; document attachments remain path markers readable through the workspace.
8. On a missing/stale Codex thread, use the existing local JSONL transcript replay path and start a new Codex thread once.
9. Defensively answer unexpected approval and request-user-input calls with decline/cancel in MVP so no headless turn hangs.

### PR 3 — Settings, launcher, skills, and interactive approvals

1. Add an Agent settings section showing `Auto`, `Claude Code`, and `Codex` plus effective backend/auth/sandbox status.
2. Change launcher preflight from “Claude is mandatory” to “the selected/auto-resolved backend is executable and authenticated”. Provide install/login steps for both providers in all locales.
3. Do not assume the Codex desktop app's private packaged binary is executable by child processes. Prefer an official CLI on PATH or a deliberately bundled `@openai/codex` runtime.
4. Extend the skill bridge to make canonical `data/skills/<slug>/SKILL.md` skills discoverable at `.agents/skills/<slug>/SKILL.md`, or register that canonical root through app-server. Keep `.claude/skills` for Claude.
5. Parse an existing `/skill-name` launch into Codex text `$skill-name` plus an explicit app-server `skill` input item with the resolved `SKILL.md` path. Ordinary slash-prefixed text must not be rewritten blindly.
6. Add backend-neutral approval events/API/UI for command and file-change requests. Scope responses by MulmoClaude session + Codex `threadId` + `turnId` + request id, and clear them on completion/interrupt.
7. After approval UI ships, change Codex policy from `never` to the least-permissive interactive policy that preserves the current role behavior.
8. Update README/help text from “Claude is the engine” to provider-aware wording without renaming the MulmoClaude product.

### PR 4 — Codex-only parity and live validation

1. Add a backend-neutral `generateText` / `generateStructured` service for one-shot jobs.
2. Migrate direct Claude spawns in:
   - `server/workspace/journal/archivist-cli.ts`
   - `server/workspace/chat-index/summarizer.ts`
   - `server/services/translation/llm.ts`
   - any remaining `claudeBinPath()` consumer found by the final grep
3. Replace Claude-only `haiku` / `sonnet` setting semantics with provider-neutral quality presets, retaining migration for existing settings and mapping them per backend.
4. Publish wiki page-edit/snapshot events for Codex file changes. Prefer a backend-neutral file-change publisher fed by authoritative completed `fileChange` items; only use Codex hooks if event coverage is insufficient.
5. Add a guarded `E2E_LIVE_BACKEND=codex` suite covering new chat, resume, MulmoClaude MCP visual result, skill invocation, image input, stop, and stale-token recovery.
6. Run a final Claude-specific dependency audit. With Codex selected, no normal feature path may require `claude`, `~/.claude`, Claude credentials, or the Claude Docker image.

## Tests

### Unit/contract

- backend resolution truth table (`auto`, explicit, missing binaries)
- legacy and generic session metadata migration
- Docker setup never called for Codex
- JSON-RPC initialize ordering and request correlation
- thread start/resume payloads and developer instructions
- delta/final text deduplication
- command/file/MCP start-complete mapping and error states
- malformed JSON, stderr, non-zero exit, early EOF
- abort before spawn, during initialize, and during a turn
- stale thread typed recovery and single retry budget
- MCP stdio/HTTP translation, reserved-name protection, and secret non-disclosure
- `/skill-name` exact parsing and explicit skill input
- image vs non-image attachment mapping
- approval decline/cancel fallback and later interactive resolution

Use a small fake app-server child fixture for deterministic tests; unit tests must not need OpenAI auth or network.

### Live/manual

- macOS, Linux, native Windows, and npx packaged install
- Codex-only machine (Claude absent)
- both CLIs installed, verifying `auto` preserves Claude default
- backend change on an existing MulmoClaude chat
- user MCP HTTP and stdio servers
- Codex CLI logged out/expired credentials
- incompatible/old Codex CLI with a clear upgrade message
- Codex resume after MulmoClaude server restart
- network denied by sandbox, file write inside workspace, attempted write outside workspace

### Repository gates

After every source-changing PR:

```sh
yarn format
yarn lint
yarn typecheck
yarn build
yarn test
```

Run the existing mock Playwright suite, then the guarded live Codex specs on an authenticated runner.

## Acceptance criteria

### Milestone A

- A user with an authenticated executable Codex CLI and no Claude CLI can start MulmoClaude with `agentBackend=codex`.
- A new chat streams text and persists a provider-tagged Codex thread id.
- A second turn resumes the same Codex thread without duplicating assistant text.
- At least one MulmoClaude MCP tool executes and produces the existing rich UI result.
- Stop interrupts the Codex turn and leaves no child process or pending request.
- Codex uses host paths plus its own workspace-write sandbox; no Claude Docker/config/credential function runs.
- Stale thread ids recover once from the local transcript and do not double-execute completed tools.

### Milestone B

- Existing MulmoClaude skills can be discovered and explicitly launched under both backends.
- Command/file approvals can be answered in the MulmoClaude UI and are never silently auto-accepted.
- Wiki page edits retain snapshot/history behavior.
- Journal, memory, chat index, and translation work without Claude installed.
- Launcher, README, help, diagnostics, and sandbox status accurately describe the selected backend.
- All repository gates and the guarded Codex live suite pass.

## Risks and mitigations

| Risk                                                           | Mitigation                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App-server protocol changes                                    | Support a tested minimum Codex version, generate schemas from that binary, keep a narrow adapter, and fail with an upgrade hint.                                         |
| `developerInstructions` resume behavior differs by CLI version | Add a real two-turn contract test; if the supported version does not reapply updates, persist the original instructions and inject only a bounded dynamic context delta. |
| Codex and MulmoClaude histories diverge                        | Treat MulmoClaude JSONL as recovery source only and Codex thread id as provider state; never merge both histories on a healthy resume.                                   |
| MCP config dialect drift                                       | Pure translator, schema-derived fixtures, real internal-broker smoke test, no raw user config passthrough.                                                               |
| Secrets leak through config/logging                            | Send sensitive overrides through stdio JSON-RPC, never argv; redact structured logs and test that serialized argv/log snapshots contain no secret values.                |
| Backend switch reuses the wrong opaque token                   | Persist `{backendId, token}` atomically and replay local transcript into a fresh provider thread on mismatch.                                                            |
| Headless approval deadlock                                     | MVP uses `never` and still responds decline/cancel to server requests; interactive policy activates only with the UI response path covered by tests.                     |
| Windows app binary is installed but not spawnable              | Resolve and probe the actual executable; document/install an official CLI on PATH or bundle the runtime intentionally.                                                   |

## Out of scope

- Renaming the MulmoClaude product.
- Replacing the plugin protocol or frontend SSE transport.
- Sharing one Codex app-server process across all chats before performance data justifies the concurrency complexity.
- Importing Codex desktop tasks into the MulmoClaude sidebar.
- Exposing every Codex app/plugin/automation feature in the first release.

## References

- OpenAI Codex App Server documentation: <https://learn.chatgpt.com/docs/app-server>
- OpenAI Codex app-server source/README: <https://github.com/openai/codex/tree/main/codex-rs/app-server>
- OpenAI app-server v2 thread protocol: <https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/thread.rs>
- OpenAI Codex config schema: <https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json>
- Existing backend seam plan: `plans/done/refactor-llm-backend-abstraction.md`
