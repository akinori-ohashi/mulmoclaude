# feat: presentMulmoScript uses the prompt split

Issue: #3369 (step 5 of the plan posted there; first plugin).

## Problem

`presentMulmoScript` has no `prompt`; its full usage reference lives in `description`,
which the system prompt injects as the fallback — the largest single plugin entry.

## Change

- Plugin (`@mulmoclaude/mulmoscript-plugin` 5.2.0): the reference text becomes one
  constant used for BOTH `description` (unchanged byte for byte — the MCP tool schema
  MulmoTerminal and ToolSearch read) and `promptFiles["presentMulmoScript.md"]`;
  `promptCompact` is a short summary plus a Read pointer via `{{promptFilesDir}}`.
- Host: built-in bindings learn their package from an optional `PluginMeta.packageName`
  through a new `mcpBinding(def, meta)` helper the codegen now emits; only
  `presentMulmoScript`'s META sets it.

## Verification

- Differential: old vs new definition loaded side by side — `description` and
  `parameters` identical; split valid (throwaway script).
- Plugin test: split valid, the file is the description, the compact text references it.
- Host test: syncing the built-in sources puts the told path in the system prompt, the
  full description is not in it, and the file at that path (resolved from the workspace)
  is the full reference. Removing `packageName` from the META turns it red.
