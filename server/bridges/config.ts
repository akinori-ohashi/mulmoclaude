// Which bridges the server starts in its own process (#3080).
//
// Pure: takes already-parsed JSON and returns the enabled transport ids. No fs,
// no env, no clock — so every malformed shape a user can type is testable
// without a workspace.
//
// Only the on/off switch lives in `config/bridges.json`. Credentials stay in
// `.env`, which is where every bridge already reads them from, and which is
// already excluded from backups and git.

import { isRecord } from "../utils/types.js";

export interface BridgeConfigEntry {
  enabled: boolean;
}

export interface BridgesConfig {
  /** Transport ids the user switched on, in the order the file lists them. */
  enabled: string[];
  /** Entries that could not be read, with the reason. Reported, never silently
   *  dropped: a typo'd transport id that vanishes looks exactly like a bridge
   *  the server decided not to start. */
  rejected: { key: string; reason: string }[];
}

const EMPTY: BridgesConfig = { enabled: [], rejected: [] };

/** A transport id is a bare token: it names a directory under
 *  `packages/bridges/` and a socket room, so anything that could traverse a
 *  path or collide with the room prefix is refused rather than normalised. */
const TRANSPORT_ID = /^[a-z][a-z0-9-]*$/;

export function parseBridgesConfig(raw: unknown): BridgesConfig {
  if (!isRecord(raw)) return EMPTY;
  const { bridges } = raw;
  if (!isRecord(bridges)) return EMPTY;

  const enabled: string[] = [];
  const rejected: { key: string; reason: string }[] = [];
  for (const [key, value] of Object.entries(bridges)) {
    if (!TRANSPORT_ID.test(key)) {
      rejected.push({ key, reason: "not a valid transport id (lowercase letters, digits and dashes)" });
      continue;
    }
    if (!isRecord(value)) {
      rejected.push({ key, reason: 'entry must be an object like { "enabled": true }' });
      continue;
    }
    if (typeof value.enabled !== "boolean") {
      rejected.push({ key, reason: "`enabled` must be true or false" });
      continue;
    }
    if (value.enabled) enabled.push(key);
  }
  return { enabled, rejected };
}
