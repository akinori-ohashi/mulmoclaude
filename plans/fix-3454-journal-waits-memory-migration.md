# fix: journal must not run while the boot-time memory migrations are in flight (#3454)

## Problem

`server/index.ts` starts the one-shot memory migrations (`runMemoryMigrationOnce` → `runTopicMigrationOnce`)
as a floating promise at boot. Both make LLM calls and can take minutes. Nothing stops the journal from
running meanwhile: a chat turn ending (agent route finally-hook) or the hourly scheduler task calls
`maybeRunJournal`, and the daily pass's extractor appends to `conversations/memory.md`:

- before the legacy migration renames `memory.md` → `.backup`: the appended bullets go into `.backup`
  with the rest and are no longer read;
- after the rename, before the topic swap: a new `memory.md` is created, which nothing reads once the
  swap completes (topic clustering only takes atomic entries).

## Decision (option A)

Serialise: the journal waits for the migrations to settle.

- `server/workspace/memory/startup.ts` owns the migration chain and exposes the promise that settles
  when it is done (never rejects).
- `maybeRunJournal` awaits that promise after taking its in-process lock, so concurrent triggers during
  the wait return immediately instead of piling up, and the waiting run does the pass afterwards.
- A second `startMemoryMigrations` call chains onto the running one. Tests control the wait by starting a chain with a held runner.

Out of scope:

- A topic migration that keeps failing leaves the workspace atomic across boots; facts the extractor writes
  in that state are still dropped at the eventual swap (option B in the issue, not chosen).
- Bullets already lost to this race are not recovered.

## Tests

- `maybeRunJournal` does not reach `summarize` until the migration wait settles, then does.
- A trigger arriving during the wait returns without running a second pass.
- `startMemoryMigrations`: the settled promise resolves after the chain, and resolves (not rejects) when a
  runner throws; runners run in order.
