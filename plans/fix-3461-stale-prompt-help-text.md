# fix: stale prompt / help / file-descriptor text (#3461)

## Problem

Text the agent reads every turn or on demand, and text the user sees in the file explorer, describes an
older layout: `system.md` lists an unused `data/contacts/` and calls `data/scheduler/` the scheduled-task
store; `helps/index.md` shows the pre-#284 root layout with `memory.md`; `helps/wiki.md` says to distil into
`memory.md`; the file descriptors call `conversations/memory.md` "always loaded" and `data/scheduler/items.json`
"ready to fire", and point `schedulerOverrides` at the wrong schema file; `docs/memory.md` says topic bodies
are inlined.

## Decision

Correct each text to the current behaviour; no code paths change.

- `system.md`: drop `data/contacts/`; scheduled tasks → `config/scheduler/tasks.json`.
- `helps/index.md`: layout map from `WORKSPACE_FILES` / `system.md`.
- `helps/wiki.md`: memory = topic files, index line in context.
- descriptors: `schedulerOverrides` schemaRef → `scheduler-overrides-io.ts`; `memory` and `schedulerItems`
  retitled as legacy files, all 8 locales.
- `docs/memory.md`: index lines only (#1432).
- `assets/helps` changed → `@mulmoclaude/core` 5.11.3, every consumer range swept, CHANGELOG `[Unreleased]`
  `Ships` line updated (enforced by `check:launcher-sync` and `check-changelog-ships`).

Out of scope: removing the legacy `/api/scheduler` items API (#3462); no new descriptor for topic files.
