// Decides whether the one-shot `memory.md` → atomic migration (#1029) may run, from facts the
// caller has already read off disk. Pure so every skip reason can be tested without a workspace.

// The init placeholder we used to write was smaller than this; a file this small has no facts.
export const LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES = 64;

export interface LegacyMemoryState {
  /** Size of `conversations/memory.md`, or null when the file is absent. */
  legacySizeBytes: number | null;
  /** `memory.md.backup` exists — the marker a previous migration completed. */
  backupExists: boolean;
  /** The workspace already uses the topic layout (#1070). */
  topicFormat: boolean;
}

export type LegacyMigrationSkipReason = "no-legacy-file" | "topic-format" | "placeholder" | "already-migrated";

export type LegacyMigrationGate = { run: true } | { run: false; reason: LegacyMigrationSkipReason };

export function decideLegacyMigration(state: LegacyMemoryState): LegacyMigrationGate {
  if (state.legacySizeBytes === null) return { run: false, reason: "no-legacy-file" };
  // Atomic files written into a topic `memory/` are never read and never re-clustered.
  if (state.topicFormat) return { run: false, reason: "topic-format" };
  if (state.legacySizeBytes < LEGACY_MEMORY_PLACEHOLDER_MAX_BYTES) return { run: false, reason: "placeholder" };
  if (state.backupExists) return { run: false, reason: "already-migrated" };
  return { run: true };
}
