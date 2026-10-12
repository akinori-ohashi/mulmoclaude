# feat: show how many skills the CLI lists on every request

Issue: #3406 (option 3), on top of the user-settings toggle (option 2, #3410).

## Problem

How heavy the `Skill` tool's listing is depends entirely on what the user installed, and nothing
in MulmoClaude shows it — so the user cannot tell whether the new toggle is worth turning off.

## Change

- `server/agent/skillListing.ts` (pure): `summariseSkillListing(frame)` reads the CLI's
  `system`/`init` frame — skill count and installed (non-`builtin`) plugin names;
  `isSkillListingHeavy` at `HEAVY_SKILL_COUNT`.
- `server/agent/skillListingState.ts`: `noteSkillListing` keeps the latest summary, logs it at
  debug, and warns once per distinct heavy count, pointing at Settings → Model.
- The Claude CLI backend calls `noteSkillListing` on every raw frame.
- `GET /api/config` returns `skillListing` (null before any turn); Settings → Model shows the
  count, the plugin names, and a hint when it is heavy. 8 locales.

## Verification

- Pure summary in both directions (init with/without plugins, malformed plugins, every
  non-init frame), the threshold boundary, the state record.
- Config route response carries `skillListing: null` before any turn.
