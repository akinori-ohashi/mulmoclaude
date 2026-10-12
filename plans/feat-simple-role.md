# feat: a built-in `simple` role for light conversation

Issue: #3369 (step 4 of the plan posted there).

## Problem

Every role sends the full base prompt plus the descriptions of its display tools on
each turn. General carries the heaviest ones (`presentMulmoScript`, `presentDocument`,
`presentHtml`, image generation), which plain conversation never uses.

## Change

- New built-in role `simple` (`src/config/roles.ts`), right after `general`:
  - `availablePlugins`: `presentForm` (the base prompt routes every clarifying question
    through it) and `presentCollection` (show a collection, not just read it).
  - The always-active tools (`manageCollection`, `spawnBackgroundChat`) stay, as agreed.
  - Short prompt; for documents / slides / images / HTML it suggests switching to General.
- Role lists updated: the eight READMEs, `helps/index.md` (core asset → core 5.10.1,
  ranges swept), `docs/extension-mechanisms.md`, `docs/migrating-from-claude-code.md`,
  CHANGELOG.

## Verification

- `test/agent/test_simpleRole.ts`: keeps `presentForm` + `presentCollection`, carries none
  of the heavy display tools, and its system prompt is shorter than General's.
- Measured with an empty memory snapshot (`buildSystemPrompt`): see the PR body for the
  command; Simple's prompt is well under General's.
