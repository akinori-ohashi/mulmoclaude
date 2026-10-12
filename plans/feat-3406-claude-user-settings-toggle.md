# feat: a setting to stop loading Claude Code's user settings and plugins

Issue: #3406 (option 2 of the measured options).

## Problem

The agent CLI loads every setting source, so the `Skill` tool lists every skill from installed
Claude Code plugins. In a workspace measured on one machine, a plugin with over a thousand
skills made each request roughly 36,000 input tokens heavier; the workspace's own skills cost
about 3,400. The CLI's listing limits (`SLASH_COMMAND_TOOL_CHAR_BUDGET`,
`skillListingMaxDescChars`, `skillListingBudgetFraction`) barely move it — the weight is the
number of skills.

## Change

- `AppSettings.loadClaudeUserSettings?: boolean`, default `true` (`isClaudeUserSettingsEnabled`),
  registered in every settings choke point (keys, safe keys, validators, clone, save).
- `buildAgentInput` → `AgentInput.loadClaudeUserSettings` → `cliArgsForInput` →
  `buildCliArgs`: an explicit `false` adds `--setting-sources project,local`, so the
  workspace's `.claude/` still loads.
- Settings → Model gets a checkbox, labelled in all 8 locales.
- `isAppSettingsPatch`'s boolean checks move into one key list (complexity limit).

## Verification

- Validator table, save/load round trip, default; `buildCliArgs` with true / undefined / false;
  the `buildAgentInput` wiring.
- The real CLI driven with `buildCliArgs` output in the workspace: off drops the skill count
  and the per-request input tokens, and the turn still answers.
