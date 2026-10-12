# feat: manageCollection uses the prompt split

Issue: #3369 (step 5, third tool). `manageCollection` is `alwaysActive`, so its
guidance is in EVERY role's system prompt, Simple included.

## Change

- Core (`@mulmoclaude/core` 5.11.0): `makeManageCollectionTool` also returns
  `promptCompact` and `promptFiles["manageCollection.md"]` (the unchanged `prompt`).
  The compact text keeps what decides whether / how to call the tool, plus the one write
  rule whose omission loses data (a partial upsert erases omitted fields → `merge`); the
  write gate, `lint` and field-format detail sit behind a Read before record writes.
- Host: `McpTool` gains optional `promptCompact` / `promptFiles` / `packageName`;
  `activeTools` renders MCP tools through `toolPromptFor`; `MCP_TOOL_PROMPT_FILE_SOURCES`
  joins the startup sync; `manageCollection` sets `packageName: "@mulmoclaude/core"`.
- For MCP tools the `prompt` reaches the agent only through the system prompt (the MCP
  description is `definition.description` alone), so the file is where the full text
  lives once the split applies. MulmoTerminal keeps using `prompt`.

## Verification

- Core test: split valid, file is `prompt`, compact keeps the merge rule and the pointer.
- Host tests: every MCP tool declaring a split carries `packageName`; after syncing the
  MCP sources, a role with no plugins gets the told path in its prompt (not the full
  text) and the file at that path is the full prompt. Removing `packageName` turns both red.
