# fix: new workspaces start in the atomic memory layout (#3456)

## Problem

`initWorkspace` creates an empty `conversations/memory/`, so `hasTopicFormat()` is false and the agent gets the
atomic write rules while `system.md` describes topic files. A new user only reaches topic format after writing
atomic entries, restarting, and a successful clustering LLM call.

## Decision

`initWorkspace` creates the four `conversations/memory/<type>/` directories when the workspace has no memory to
lose — then `hasTopicFormat()` is true from the first turn and the migration chain has nothing to do.

"No memory to lose" (pure rule, `server/workspace/memory/seed-topic-layout.ts`):
- no `conversations/memory.next/` (a staged or mid-swap topic migration owns that state);
- `conversations/memory.md` absent, or exactly the pre-#1029 init placeholder;
- `conversations/memory/` holds nothing but the atomic `MEMORY.md` index and dot-entries.

`initWorkspace` runs on every boot, so the rule must never flip an atomic workspace that has entries — those go
through `runTopicMigrationOnce` as before. The placeholder `memory.md` is left on disk (user data rule).

## Tests

- rule: every reason in both directions — empty / absent dir, index-only, dot-entries, an atomic entry, a type
  dir, staging, placeholder vs real `memory.md`, placeholder with trailing edits.
- init wiring: a fresh temp workspace becomes topic format; one with an atomic entry stays atomic.
