# feat: let a role opt out of an always-active tool

Issue: #3402 (item 2), follow-up of #3369.

## Problem

`alwaysActive` MCP tools (`manageCollection`, `spawnBackgroundChat`) are offered to every role,
regardless of `availablePlugins`. The Simple role, meant for plain conversation, never
pre-generates artifacts, yet carries `spawnBackgroundChat`'s prompt section and tool definition
on every turn.

## Change

- `RoleSchema` gains an optional `excludedAlwaysActiveTools: string[]`.
- The MCP-tool gate in `getActiveToolDescriptors` moves to the pure, exported
  `isMcpToolOfferedTo(role, toolName, alwaysActive)`:
  `listed || (alwaysActive && !excluded)`. Without the field this is the old
  `alwaysActive || listed`; a role that lists a tool it also excludes still gets it.
- The Simple role excludes `spawnBackgroundChat`. `manageCollection` stays.
- The prompt section, the MCP child's tool list and `--allowedTools` all derive from
  `getActiveToolDescriptors`, so the tool disappears from all three together.

## Verification

- Truth-table test over listed × alwaysActive × excluded, plus the "no field = old rule" check.
- `test_simpleRole.ts`: Simple drops `spawnBackgroundChat`, General keeps it.
- Removing the exclusion check turns those tests red.
