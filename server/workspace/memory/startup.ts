// Boot-time memory migration chain plus the promise other subsystems wait on before touching
// `conversations/memory.md` — the journal's extractor appending mid-migration loses those bullets.

import { runMemoryMigrationOnce } from "./run.js";
import { runTopicMigrationOnce } from "./topic-run.js";

export type MemoryMigrationRunner = (workspaceRoot: string) => Promise<void>;

const DEFAULT_RUNNERS: readonly MemoryMigrationRunner[] = [runMemoryMigrationOnce, runTopicMigrationOnce];

let migrationsSettled: Promise<void> = Promise.resolve();

export function startMemoryMigrations(workspaceRoot: string, runners: readonly MemoryMigrationRunner[] = DEFAULT_RUNNERS): void {
  migrationsSettled = runInOrder(workspaceRoot, runners);
}

// Never rejects: a failed migration must not wedge the journal behind it.
export function memoryMigrationsSettled(): Promise<void> {
  return migrationsSettled;
}

async function runInOrder(workspaceRoot: string, runners: readonly MemoryMigrationRunner[]): Promise<void> {
  try {
    await runners.reduce<Promise<void>>((previous, runner) => previous.then(() => runner(workspaceRoot)), Promise.resolve());
  } catch {
    // Each runner logs its own failure; stopping the chain here matches the previous `.then(noop, noop)`.
  }
}
