# fix: the MCP child dispatches only tools it publishes

Issue: #3407 (found in the #3404 review).

## Problem

`tools/list` serves the role's active tools, but `tools/call` looked pure MCP tools up in the
all-roles registry (`mcpTools`), so naming a tool the role does not carry still dispatched it.
Not reachable through Claude Code today (it rejects names absent from `tools/list` with
"No such tool available"), so this is defence in depth.

## Change

- `server/agent/dispatchableMcpTool.ts` — pure `findDispatchableMcpTool(name, registry,
  publishedNames)`: a registry hit counts only when the name is on the published surface.
- `mcp-server.ts`: `handleToolCall` dispatches through it with the names in `tools` (the
  `tools/list` surface); `isToolKnown` drops its registry shortcut, so an unpublished name
  waits for runtime-plugin load like any unknown name and then gets `Unknown tool`.
- `manageSkills` and `handlePermission` are unchanged (special case / always in `tools`).

## Verification

- Unit test of the pure gate, both directions, plus prototype-like and near-miss names.
- Broker smoke test: `tools/call spawnBackgroundChat` without it in `PLUGIN_NAMES` →
  `Unknown tool`; with it → a dispatch attempt. Restoring the registry lookup turns it red.
