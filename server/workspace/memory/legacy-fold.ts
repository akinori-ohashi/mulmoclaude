// Bullets from a leftover `conversations/memory.md` that the atomic → topic cluster must include, or they drop out of
// the prompt at the swap (#3460). By the time topic migration clusters, a present `memory.md` is never going to be
// handled by the #1029 migration: it sits beside `.backup`, or is under its placeholder threshold.

import type { MemoryCandidate } from "./migrate.js";
import type { MemoryEntry, MemoryType } from "./types.js";

// Nothing classifies these bullets; the clusterer files them by the type it is given.
export const FOLDED_LEGACY_TYPE: MemoryType = "fact";

const FOLDED_NAME_MAX_CHARS = 80;

function dedupeKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Turn legacy bullets into cluster input, skipping any already present as an atomic entry body or earlier bullet. */
export function legacyFoldEntries(candidates: readonly MemoryCandidate[], atomicEntries: readonly MemoryEntry[]): MemoryEntry[] {
  const seen = new Set(atomicEntries.map((entry) => dedupeKey(entry.body)));
  const folded: MemoryEntry[] = [];
  candidates.forEach((candidate, index) => {
    const key = dedupeKey(candidate.body);
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    folded.push({
      type: FOLDED_LEGACY_TYPE,
      name: candidate.body.slice(0, FOLDED_NAME_MAX_CHARS),
      description: candidate.section || "from conversations/memory.md",
      body: candidate.body,
      slug: `${FOLDED_LEGACY_TYPE}_legacy-${index}`,
    });
  });
  return folded;
}
