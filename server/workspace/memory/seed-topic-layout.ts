// Whether a workspace may start directly in the topic memory layout (#1070) instead of passing through the
// atomic one. Only when there is no memory to lose: anything else must go through the migration chain.

// What `initWorkspace` used to write into a fresh `memory.md` before #1029; it holds no facts.
export const LEGACY_MEMORY_PLACEHOLDER = "# Memory\n\nDistilled facts about you and your work.\n";

// The atomic layout's generated index; present even when no entry was ever written.
const ATOMIC_INDEX_FILE = "MEMORY.md";

export interface MemoryLayoutState {
  /** Names directly under `conversations/memory/`; empty when the directory is absent. */
  memoryDirEntries: readonly string[];
  /** Contents of `conversations/memory.md`, or null when absent. */
  legacyMemoryText: string | null;
  /** `conversations/memory.next/` exists — a topic migration is staged or mid-swap. */
  stagingExists: boolean;
}

export function shouldSeedTopicLayout(state: MemoryLayoutState): boolean {
  if (state.stagingExists) return false;
  if (state.legacyMemoryText !== null && state.legacyMemoryText !== LEGACY_MEMORY_PLACEHOLDER) return false;
  return state.memoryDirEntries.every((name) => name === ATOMIC_INDEX_FILE || name.startsWith("."));
}
