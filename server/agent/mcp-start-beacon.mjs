// The first thing the MCP broker process does (#2842).
//
// Loaded with `--import`, so node evaluates it BEFORE the broker's own entry —
// before tsx transcodes the 292-file import graph, and before node reads the
// 6 MB bundle. That ordering is the point: it turns "the process exists" into
// something the host can see, separately from "the process finished booting",
// which the ready beacon reports afterwards. A broker that is merely slow has
// answered this within milliseconds; one that never launched never will, and
// that difference is what lets the failure warn name the boot or the spawn
// instead of folding both into one symptom. Diagnostic only — nothing here
// ends a turn (#2842).
//
// TWO signals, because they fail for unrelated reasons:
//
//   1. A marker file, written synchronously. Measured at 59 ms into a process
//      whose boot went on for another 890 ms.
//   2. An HTTP beacon to the host, retried.
//
// The file is the one that actually beats a slow boot. Node is single
// threaded, and tsx's transcode blocks the event loop, so the fetch below
// cannot complete until the boot it is supposed to precede has finished — on
// the tsx path both beacons reached the host 2 ms apart. The HTTP beacon
// stays because it needs no shared filesystem: it covers the mount being
// unwritable or slow to propagate, where the file covers the network being
// blocked. The host holds off if EITHER arrives.
//
// Import-free apart from node builtins: importing anything of this repo's
// would be loaded before the signal fires, reintroducing the very delay the
// signal exists to precede. That is also why the retry below is written out
// rather than shared with `brokerBeacon.ts`.

import { closeSync, constants, openSync, writeSync } from "node:fs";

const HOST = process.env.MCP_HOST || "localhost";
const PORT = process.env.PORT || "";
const SESSION_ID = process.env.SESSION_ID || "";
const SPAWN_ID = process.env.MCP_SPAWN_ID || "";
const TOKEN = process.env.MULMOCLAUDE_AUTH_TOKEN || "";
const MARKER_PATH = process.env.MCP_START_MARKER || "";

// Short and repeated rather than long and single: the host is deciding whether
// this process is alive, so a late delivery is worth little.
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const TIMEOUT_MS = 2000;

/** Create the marker, refusing to write through anything that is already there.
 *
 *  Under Docker this path is inside the workspace bind mount, which the
 *  sandboxed agent can write — so a plain write would follow a symlink planted
 *  at that path and truncate whatever it points at. No privilege is crossed
 *  (the broker runs as the same uid in the same container, so the agent could
 *  write the target itself), but a write that follows an attacker-placed link
 *  is wrong regardless, and the marker never wants to overwrite anything:
 *
 *  - `O_EXCL` — the name carries a fresh per-spawn UUID, so an existing file is
 *    already not ours. Refusing is also what makes a planted one harmless.
 *  - `O_NOFOLLOW` — never traverse a symlink at the final component. POSIX
 *    only; on Windows the constant is absent and falls out of the mask, where
 *    `O_EXCL` alone still refuses a planted entry.
 *
 *  Exported for the unit test; the call below is what runs in the broker. */
export function writeStartMarker(markerPath, spawnId) {
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = openSync(markerPath, flags, 0o600);
  try {
    writeSync(handle, spawnId);
  } finally {
    closeSync(handle);
  }
}

// Synchronous and first, so it lands even while the boot that follows holds the
// event loop. Failure is not worth reporting: the HTTP beacon is the fallback,
// and a broker that cannot write here still works.
if (MARKER_PATH) {
  try {
    writeStartMarker(MARKER_PATH, SPAWN_ID);
  } catch {
    // ignored — see above
  }
}

const wait = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs).unref();
  });

async function send() {
  const url = `http://${HOST}:${PORT}/api/mcp/broker-starting?session=${encodeURIComponent(SESSION_ID)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ spawnId: SPAWN_ID }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function deliver(remaining) {
  try {
    await send();
  } catch (err) {
    if (remaining <= 1) {
      // The broker's stderr belongs to Claude CLI, so this line is for a
      // developer running the broker by hand. The host's own log says what the
      // missing signal meant for the turn.
      process.stderr.write(`[mcp-start-beacon] undelivered after ${ATTEMPTS} attempts: ${String(err)}\n`);
      return;
    }
    await wait(RETRY_DELAY_MS);
    await deliver(remaining - 1);
  }
}

// Never awaited, and never able to reject: this is fire-and-forget from a
// module the broker loads before anything else, so a rejection here becomes an
// unhandled rejection in the broker rather than a missing diagnostic. The
// reporter is the reachable path — it writes to a stderr pipe Claude CLI owns,
// and a CLI that has already exited turns that write into an EPIPE throw. The
// same escape was found in `brokerBeacon.ts` (Codex review on #2931); this copy
// exists only because the preload may not import anything.
if (PORT && SESSION_ID) void deliver(ATTEMPTS).catch(() => {});
