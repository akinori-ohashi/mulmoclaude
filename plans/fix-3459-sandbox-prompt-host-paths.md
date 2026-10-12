# fix: sandbox prompt reads wiki / legacy memory from the container path on the host (#3459)

## Problem

`buildFullSystemPrompt` (`server/agent/index.ts`) passes `CONTAINER_WORKSPACE_PATH` as `workspacePath`
to `buildSystemPrompt` when Docker is on. That one value is used for two different things:

- the path shown to the agent (`Workspace directory: …`) — correct as the container path;
- host-side file reads in the same process: `buildWikiContext` and `buildMemoryContext` →
  `readLegacyMemoryFile` — wrong, `/home/node/mulmoclaude/...` does not exist on the host.

So sandbox users always get "No wiki exists yet", and atomic workspaces lose legacy `memory.md`.
The memory-format snapshot was already loaded from the host path (#1280); these two readers were not.

## Decision

- `SystemPromptParams` gets a required `hostWorkspacePath`. Host-side readers use it; `workspacePath`
  stays the agent-facing path. Required, not defaulted, so a future caller cannot silently reintroduce
  the bug.
- The choice of which path goes where is a pure function next to `CONTAINER_WORKSPACE_PATH`
  (`promptWorkspacePaths(hostWorkspacePath, useDocker)`), routed through by `buildFullSystemPrompt`.

Out of scope: moving the wiki / legacy-memory reads into pre-loaded snapshots (larger refactor of the
prompt tests); other `CONTAINER_WORKSPACE_PATH` consumers (they format agent-facing text only).

## Tests

- `promptWorkspacePaths`: host path is always the real host path; agent path is the container path
  only under Docker.
- `buildSystemPrompt` with `workspacePath` = container path and `hostWorkspacePath` = a temp workspace
  holding a wiki summary: the summary is in the prompt and the agent-facing line shows the container path.
