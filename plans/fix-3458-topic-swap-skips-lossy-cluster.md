# fix: atomic → topic swap runs even when the cluster dropped bullets; docs say it is opt-in (#3458)

## Problem

`runTopicMigrationOnce` swaps the staged topic tree in right after clustering, with no opt-in, while
`topic-swap.ts`, `docs/memory.md` and a `server/index.ts` comment say the swap waits for the user. It swapped even
when `bulletsLost > 0`, so bullets the LLM dropped left the live memory. And the retry-swap path promoted any
leftover `memory.next/`, including the empty dir created before the cluster call.

## Decision (maintainer: keep auto-swap)

- Auto-swap stays; the docs and comments describe it.
- A lossy cluster (`bulletsLost > 0`) or one whose topic files failed to write is never staged: the check runs in
  `clusterAtomicIntoStaging` before the staging index is written, and the staging dir is removed. The workspace
  stays atomic and the next start clusters again.
- The staging index (`MEMORY.md`, written last) marks a complete staging. The retry-swap path swaps a leftover
  staging only when it has the index AND its topic files hold at least one bullet per atomic entry (builds before
  this fix indexed lossy stagings too); anything else is discarded and re-clustered.

Out of scope: `bulletsLost` is a count, so a cluster that duplicates one bullet and drops another nets to zero.
