# fix: a leftover memory.md drops out of the prompt at the atomic → topic swap (#3460)

## Problem

In atomic format the prompt reads `conversations/memory.md`. The atomic → topic cluster only takes atomic entries,
and after the swap the topic prompt never reads `memory.md`. So bullets in a `memory.md` that the #1029 migration
will never handle — one under its 64-byte placeholder threshold, or one re-created next to `memory.md.backup` (e.g.
by the daily-pass extractor before #3452) — leave the prompt at the swap. (Option B from #3454.)

## Decision

When `clusterAtomicIntoStaging` clusters, it also feeds the bullets of a present `memory.md` to the clusterer.
By then a present `memory.md` is always such a leftover: `topic-run` defers while the #1029 migration still owns it.

- Pure rule `server/workspace/memory/legacy-fold.ts`: bullets → cluster input entries, typed `fact` (nothing
  classifies them), skipping any already present as an atomic entry body (case / whitespace-insensitive) and
  repeats. Bullets are parsed with the #1029 migration's `parseCandidates`, now exported.
- They count toward `inputCount` / `bulletsLost`, so a cluster that drops one does not swap (#3458 / #3471).
- `memory.md` stays on disk (user data); after the swap the topic prompt ignores it as before.

Out of scope: classifying the folded bullets (they all start as `fact`); prose lines (not bullets).
