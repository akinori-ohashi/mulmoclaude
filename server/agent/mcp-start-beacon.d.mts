// Type declarations for the broker's startup preload (`mcp-start-beacon.mjs`).
// Kept alongside the .mjs so it stays in step with any signature changes.

/** Create the per-spawn start marker at `markerPath`.
 *
 *  Throws rather than overwriting: the path lives in a directory the sandboxed
 *  agent can write, so the open refuses both an existing entry and a symlink.
 *  The caller treats a throw as "no marker", which the HTTP beacon covers. */
export function writeStartMarker(markerPath: string, spawnId: string): void;
