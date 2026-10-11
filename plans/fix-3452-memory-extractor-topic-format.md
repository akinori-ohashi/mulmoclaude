# fix: daily-pass memory extractor writes legacy memory.md in topic-format workspaces (#3452)

## Problem

- `extractAndAppendMemory` (`server/workspace/journal/memoryExtractor.ts`) always appends to
  `conversations/memory.md`.
- In a topic-format workspace (#1070) `buildMemoryContext` reads only the topic index, so the
  appended facts reach nobody and the file only grows.
- Side effect: `runMemoryMigrationOnce` (`server/workspace/memory/run.ts`) does not check the
  format. With a grown `memory.md` and no `.backup`, it re-runs the #1029 migration on startup and
  drops atomic `<type>_<slug>.md` files at the root of an already-topic `memory/`, where
  `runTopicMigrationOnce` (which skips topic workspaces) never picks them up.

## Decision

Invariant: **in topic format, nothing writes or migrates the legacy `memory.md`.**

1. Extractor: return early (before the LLM call) when `hasTopicFormat(workspaceRoot)` — the same
   predicate the prompt reader uses via `loadMemorySnapshot`, so writer and reader agree.
   Routing extracted facts into topic files is a separate feature, not this fix.
2. Legacy migration: lift its skip conditions into a pure gate
   (`server/workspace/memory/legacy-migration-gate.ts`) and add "topic format active" as a skip
   reason. Non-topic behaviour is unchanged (proved by a differential run against the old
   conditions).

Out of scope:

- Existing `memory.md` files in topic workspaces are user data — left untouched.
- `topic-run.ts`'s `shouldDeferForLegacyMigration` mirrors the same conditions; it only runs when
  topic format is NOT active, so it is unaffected. Folding it onto the gate is a separate refactor.

## Tests

- Gate: every reason, both directions, boundary sizes.
- Extractor: topic workspace → summarize not called, no `memory.md` written; atomic workspace
  still appends.
- `runMemoryMigrationOnce`: topic workspace with a large `memory.md` and no `.backup` → no atomic
  files, `memory.md` untouched, summarize not called.
