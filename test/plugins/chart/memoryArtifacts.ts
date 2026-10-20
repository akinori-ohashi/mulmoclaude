import type { FileOps } from "gui-chat-protocol";

/** Artifacts that keep only the paths written, so a test can tell whether a document was saved. */
export function memoryArtifacts(): FileOps & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    read: async () => "",
    readBytes: async () => new Uint8Array(),
    write: async (rel) => {
      written.push(rel);
    },
    readDir: async () => [],
    stat: async () => ({ mtimeMs: 0, size: 0 }),
    exists: async () => false,
    unlink: async () => {},
  };
}
