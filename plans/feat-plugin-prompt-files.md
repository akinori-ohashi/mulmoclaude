# feat: plugins can split their prompt into an injected part and reference files

Issue: #3369 (step 2 of the plan posted there).

## Problem

A plugin's `prompt` is injected into the system prompt on every turn; the longest
(`presentMulmoScript`) is about 5,000 characters. Most of it is reference material
needed only when the tool is used.

## Design

- A definition may declare `promptCompact` (injected) and `promptFiles`
  (`file name → content`). `prompt` stays the full text, so a host that does not
  support the split — or could not write the files — injects it unchanged.
- Contents, not paths: the host writes them, so there is no package-root lookup
  (ESM/CJS, `exports` hiding `package.json`, runtime-plugin cache).
- Files go under `<root>/<package>/` in the `node_modules` layout, package name supplied
  by the host. Only the packages passed in are replaced (staging dir + rename), so a
  root shared by several MulmoTerminal instances is never pruned.
- `{{promptFilesDir}}` is replaced with the path the host's AGENT reads from:
  - MulmoClaude: `config/helps/plugins/<package>` — workspace-relative; the agent's cwd
    is the workspace natively and in Docker (`/home/node/mulmoclaude`).
  - MulmoTerminal (later PR): absolute `~/.mulmoterminal/plugin-docs/<package>`, plus
    `--add-dir`, because its agent starts in a project directory.
- Shared code in `@mulmoclaude/core/prompt-files` (pure `split.ts`, fs `sync.ts`).

## MulmoClaude wiring

- `server/agent/promptFiles.ts`: sync at startup (after runtime plugins register), and
  look up the agent-visible dir per package.
- `activeTools.ts`: built-in (`packageName` on the binding) and runtime tools use
  `renderToolPrompt`. MCP tool descriptions (`mcp-server.ts`) keep the full `prompt`.
- No bundled plugin adopts it in this PR.

## Verification

- Core: name rules, rendering and fallback, writing / replacing / merging / refusing.
- Host: the agent path resolved from the workspace opens the file; compact injected
  only when written; full prompt otherwise; plugin without a split unchanged.
- Mutation: absolute host path, runtime wiring removed, fallback removed — each red.
