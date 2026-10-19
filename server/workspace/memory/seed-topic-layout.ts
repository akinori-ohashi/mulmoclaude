// Whether a workspace may start directly in the topic memory layout (#1070) instead of passing through the
// atomic one. Only when there is no memory to lose: anything else must go through the migration chain.

// What `initWorkspace` used to write into a fresh `memory.md` before #1029; it holds no facts.
export const LEGACY_MEMORY_PLACEHOLDER = "# Memory\n\nDistilled facts about you and your work.\n";

// Entries that can sit in an empty memory dir: the atomic layout's generated index and Finder metadata.
// Anything else — including a `.atomic-backup-*` dir, which can hold entries — means there is memory to keep.
const HARMLESS_MEMORY_DIR_ENTRIES: ReadonlySet<string> = new Set(["MEMORY.md", ".DS_Store"]);

export interface MemoryLayoutState {
  /** Names directly under `conversations/memory/`; empty when the directory is absent. */
  memoryDirEntries: readonly string[];
  /** Contents of `conversations/memory.md`, or null when absent. */
  legacyMemoryText: string | null;
  /** `conversations/memory.next/` exists — a topic migration is staged or mid-swap. */
  stagingExists: boolean;
  /** Something could not be read (other than "does not exist"), so the state is unknown. */
  unreadable: boolean;
}

function normaliseText(text: string): string {
  return text.replace(/^\uFEFF/u, "").replace(/\r\n/g, "\n");
}

export function isLegacyMemoryPlaceholder(text: string): boolean {
  return normaliseText(text) === LEGACY_MEMORY_PLACEHOLDER;
}

export function shouldSeedTopicLayout(state: MemoryLayoutState): boolean {
  if (state.unreadable || state.stagingExists) return false;
  if (state.legacyMemoryText !== null && !isLegacyMemoryPlaceholder(state.legacyMemoryText)) return false;
  return state.memoryDirEntries.every((name) => HARMLESS_MEMORY_DIR_ENTRIES.has(name));
}
