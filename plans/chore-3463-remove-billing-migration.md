# chore: remove the billing migration that can no longer fire (#3463)

## Problem

`migrateLegacyBillingPresets` (`server/workspace/billing-migration.ts`, called late in `startRuntimeServices`)
was meant to delete starred `mc-{clients,worklog,invoice,profile}` skills and show a one-time "Invoicing moved"
notice. Two days after it shipped (v0.7.0), the generic retired-preset prune in `syncActivePresetSkills`
(run earlier, from `initWorkspace`) started deleting the same real directories first, so the billing step finds
nothing and its notice never fires. The billing help pages still tell users to Unstar the old skills.

## Decision (maintainer: delete)

- Delete `billing-migration.ts` and its boot call.
- Help pages: the old copied `mc-*` skills are removed at startup; a symlinked one (which the generic prune
  skips) can be Unstarred.
- Keep the `billingMigration.*` locale keys: a notice already in a user's bell history renders through them.
- `assets/helps` changed → `@mulmoclaude/core` 5.11.3, consumer ranges, CHANGELOG `[Unreleased]` `Ships` line.
