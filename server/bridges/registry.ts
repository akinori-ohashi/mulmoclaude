// Starts the bridges the workspace enabled, inside the server process (#3080).
//
// The shape mirrors `connectRelay` in `attachTransports()`: read config, start
// what is switched on, keep a handle for shutdown. What it deliberately does
// NOT do is supervise processes — an in-process bridge has no process of its
// own, which is the whole reason this route exists.
//
// Failure policy (#3080 C-4): a bridge that cannot start must not stop the
// server. Each start is isolated; the failure is logged and the rest continue,
// matching the Relay client, which skips silently when its env is absent.

import { createInProcessBridgeClient, type BridgeClient } from "@mulmobridge/client";
import { WORKSPACE_FILES, workspacePath } from "../workspace/paths.js";
import { resolvePath } from "../utils/files/workspace-io.js";
import { loadJsonFile } from "../utils/files/json.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/types.js";
import { parseBridgesConfig } from "./config.js";

const LOG_PREFIX = "bridges";

/** What every in-process bridge gives back. Structural rather than imported
 *  from one bridge, so the table below can hold 25 of them. */
export interface InProcessBridgeHandle {
  close: () => void;
  done: Promise<void>;
}

/** The host surface a bridge needs: the relay to send into, and the push
 *  registration to receive from. Both come from `chatService`. */
export interface BridgeHost {
  relay: Parameters<typeof createInProcessBridgeClient>[0]["relay"];
  registerInProcessBridge: Parameters<typeof createInProcessBridgeClient>[0]["registerPush"];
}

type BridgeStarter = (client: BridgeClient, env: Record<string, string | undefined>) => Promise<InProcessBridgeHandle>;

/** Transport id → how to start it in-process. One entry per converted bridge;
 *  #3080 converts the remaining 24 in follow-up PRs. A transport the user
 *  enables that is not in here is reported, not ignored.
 *
 *  The import is DYNAMIC because a bridge package is optional: the server runs
 *  perfectly well without any of them installed, and making 25 chat platforms a
 *  hard dependency of every install is not a trade worth making. A package that
 *  is not there fails here and is reported as "not installed", which is also the
 *  honest answer. */
const STARTERS: Readonly<Record<string, BridgeStarter>> = {
  telegram: async (client, env) => {
    const { readTelegramEnv, startTelegramBridge } = await import("@mulmobridge/telegram/start");
    return startTelegramBridge({ ...readTelegramEnv(env), client });
  },
};

export interface StartedBridges {
  /** Stops every bridge that started. Safe to call more than once. */
  closeAll: () => void;
  /** Transport ids actually running, for tests and for the startup log. */
  running: string[];
}

/** The transports the workspace switched on, or an empty list when the file is
 *  absent, unreadable or malformed. Never throws: the caller's isolation — and
 *  the server's boot — depend on this resolving. */
function readEnabledTransports(workspaceRoot: string | undefined): string[] {
  let config;
  try {
    // `loadJsonFile` swallows ENOENT but RETHROWS anything else — EACCES on a
    // workspace file is a real read failure, not an absent one.
    config = parseBridgesConfig(loadJsonFile<unknown>(resolvePath(workspaceRoot ?? workspacePath, WORKSPACE_FILES.bridges), {}));
  } catch (err) {
    log.error(LOG_PREFIX, "could not read config/bridges.json — no bridges started", { error: errorMessage(err) });
    return [];
  }
  for (const { key, reason } of config.rejected) {
    log.warn(LOG_PREFIX, "ignoring a malformed entry in config/bridges.json", { key, reason });
  }
  return config.enabled;
}

/** Starts one bridge, or returns null having logged why it could not. C-4: a
 *  bridge that cannot start must not stop the server. */
async function startOne(transportId: string, deps: { host: BridgeHost; env: Record<string, string | undefined> }): Promise<InProcessBridgeHandle | null> {
  const starter = STARTERS[transportId];
  if (!starter) {
    log.warn(LOG_PREFIX, "enabled bridge cannot run in-process yet — start it with its CLI instead", { transportId });
    return null;
  }
  try {
    const client = createInProcessBridgeClient({
      transportId,
      relay: deps.host.relay,
      registerPush: deps.host.registerInProcessBridge,
    });
    const handle = await starter(client, deps.env);
    // The poll loop outlives this call, so its rejection has nowhere else to
    // land. Without this an unhandled rejection takes the SERVER down — the
    // exact blast radius this isolation exists to prevent.
    handle.done.catch((err: unknown) => log.error(LOG_PREFIX, "bridge stopped with an error", { transportId, error: errorMessage(err) }));
    log.info(LOG_PREFIX, "bridge started in-process", { transportId });
    return handle;
  } catch (err) {
    log.error(LOG_PREFIX, "bridge failed to start — the server continues without it", { transportId, error: errorMessage(err) });
    return null;
  }
}

export async function startConfiguredBridges(deps: {
  host: BridgeHost;
  env?: Record<string, string | undefined>;
  workspaceRoot?: string;
}): Promise<StartedBridges> {
  const env = deps.env ?? process.env;
  const handles: InProcessBridgeHandle[] = [];
  const running: string[] = [];
  for (const transportId of readEnabledTransports(deps.workspaceRoot)) {
    const handle = await startOne(transportId, { host: deps.host, env });
    if (handle === null) continue;
    handles.push(handle);
    running.push(transportId);
  }

  let closed = false;
  return {
    running,
    closeAll() {
      if (closed) return;
      closed = true;
      for (const handle of handles) {
        try {
          handle.close();
        } catch (err) {
          log.warn(LOG_PREFIX, "bridge close failed", { error: errorMessage(err) });
        }
      }
    },
  };
}
