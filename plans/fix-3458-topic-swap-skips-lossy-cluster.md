# fix: atomic → topic swap runs even when the cluster dropped bullets; docs say it is opt-in (#3458)

## Problem

`runTopicMigrationOnce` swaps the staged topic tree in right after clustering, with no opt-in, while
`topic-swap.ts`, `docs/memory.md` and a `server/index.ts` comment say the swap waits for the user. And it swaps even
when `bulletsLost > 0`, so bullets the LLM dropped leave the live memory (they survive only under `.atomic-backup-*`).

## Decision (maintainer: keep auto-swap)

- Auto-swap stays; the docs and comments now describe it.
- When `bulletsLost > 0`, do not swap. Discard the staging (not keep it): a leftover `memory.next/` is retried as a
  swap on the next start without any loss check, so keeping it would just postpone the lossy swap. The workspace
  stays atomic — fully readable — and the next start clusters again.

Out of scope: `bulletsLost` is a count (placed vs entries); an LLM that duplicates one bullet and drops another
nets to zero. Identifying dropped bullets by text is unreliable because the clusterer may reword them.
