// Plugin runtime construction — the per-plugin scoped object
// `definePlugin(setup)` factories receive at load time (#1110).
//
// Every helper closes over `pkgName` so a plugin's pubsub channel,
// data dir, log prefix etc. cannot leak across plugins. Path arguments
// to `files.{data,config,artifacts}` are confined to their scope root
// by `makeConfinedFileOps` — lexically, then by realpath, so neither
// `"../../etc/passwd"` nor a symlink inside the root leads out.
//
// This module is server-side only. The browser-side counterpart lives
// at `src/utils/plugin/runtime.ts`.

import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileOps, PluginFetchJsonOptions, PluginFetchOptions, PluginRuntime } from "gui-chat-protocol";

import { WORKSPACE_PATHS, workspacePath } from "../workspace/paths.js";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { errorMessage } from "../utils/errors.js";
import { isRecord } from "../utils/types.js";
import { log as hostLog, type Logger } from "../system/logger/index.js";
import { makeConfinedFileOps } from "./confined-file-ops.js";
import { ONE_SECOND_MS } from "../utils/time.js";
import type { IPubSub } from "../events/pub-sub/index.js";
import * as notifierEngine from "../notifier/engine.js";
import type { MulmoclaudeRuntime, NotifierRuntimeApi } from "../notifier/runtime-api.js";
import type { ITaskManager } from "../events/task-manager/index.js";
import type { TasksRuntimeApi } from "./runtime-tasks-api.js";
import type { ChatRuntimeApi } from "./runtime-chat-api.js";
import { startChat } from "../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../src/types/session.js";
import { BUILTIN_ROLE_IDS } from "../../src/config/roles.js";

const DEFAULT_FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// ─────────────────────────────────────────────────────────────────────
// Scoped FileOps factory
// ─────────────────────────────────────────────────────────────────────

/** Shared (NOT per-plugin) FileOps rooted at the workspace `artifacts/`
 *  dir. Backs `runtime.files.artifacts`, and is exported so host routes can
 *  inject the same generic capability into directly-consumed plugins (e.g.
 *  @mulmoclaude/chart-plugin's `executeChart`) — the plugin owns its
 *  category subdir (`charts/`, …) and all write logic; the host only
 *  provides this generic primitive. */
export function makeArtifactsFileOps(): FileOps {
  return makeConfinedFileOps(path.join(workspacePath, "artifacts"));
}

// ─────────────────────────────────────────────────────────────────────
// Sanitisation: pkg name → on-disk directory segment
// ─────────────────────────────────────────────────────────────────────

/** Convert an npm package name (`@org/foo`) to a single safe directory
 *  segment. URL-encodes `/` in scoped names so the scope root stays
 *  one level deep — keeps `readdir` predictable and avoids accidental
 *  traversal via the package name itself.
 *
 *  Exported for tests. */
export function sanitisePackageNameForFs(pkgName: string): string {
  return encodeURIComponent(pkgName);
}

// ─────────────────────────────────────────────────────────────────────
// Scoped logger
// ─────────────────────────────────────────────────────────────────────

/** The protocol lets a plugin log any `object`; the host logger and its
 *  sinks contract for a keyed record. Wrap rather than drop a non-record
 *  (an array) so the payload still reaches the log line. */
function toLogData(data: object | undefined): Record<string, unknown> | undefined {
  if (data === undefined || isRecord(data)) return data;
  return { value: data };
}

function makeScopedLogger(pkgName: string): PluginRuntime["log"] {
  const prefix = `plugin/${pkgName}`;
  return {
    debug: (msg, data) => hostLog.debug(prefix, msg, toLogData(data)),
    info: (msg, data) => hostLog.info(prefix, msg, toLogData(data)),
    warn: (msg, data) => hostLog.warn(prefix, msg, toLogData(data)),
    error: (msg, data) => hostLog.error(prefix, msg, toLogData(data)),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped fetch (timeout + optional host allowlist)
// ─────────────────────────────────────────────────────────────────────

const isArrayBufferBacked = (view: Uint8Array): view is Uint8Array<ArrayBuffer> => view.buffer instanceof ArrayBuffer;

/** `fetch` accepts a byte view only when it is `ArrayBuffer`-backed. A
 *  `SharedArrayBuffer`-backed one is not a `BodyInit`, and undici sends
 *  its `toString()` ("104,105,33") as the body instead of the bytes — so
 *  copy those into a transferable buffer. */
function toTransferableBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return isArrayBufferBacked(bytes) ? bytes : new Uint8Array(bytes);
}

function makeScopedFetch(pkgName: string): PluginRuntime["fetch"] {
  return async (url, opts = {}) => {
    if (opts.allowedHosts && opts.allowedHosts.length > 0) {
      const { hostname } = new URL(url);
      if (!opts.allowedHosts.includes(hostname)) {
        throw new Error(`plugin/${pkgName}: host ${hostname} not in allowedHosts`);
      }
    }
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Forward both the caller's signal (if any) and our timeout
      // signal. AbortSignal.any returns a signal that fires when
      // either input fires — Node 20+.
      const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
      const body = opts.body instanceof Uint8Array ? toTransferableBytes(opts.body) : opts.body;
      // `fetch`'s init rejects an explicit `undefined` for these, so pass only
      // what the caller actually set.
      return await fetch(url, {
        signal,
        ...(opts.method !== undefined ? { method: opts.method } : {}),
        ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
        ...(body !== undefined ? { body } : {}),
      });
    } catch (err) {
      // Re-throw with plugin context so a fan-out failure in the
      // host log immediately points at the responsible plugin
      // instead of an anonymous network error (CodeRabbit review on
      // PR #1124). Distinguishing AbortError → "timeout" is more
      // useful than the bare "AbortError: This operation was aborted"
      // message that surfaces from AbortController.
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`plugin/${pkgName}: fetch timed out after ${timeoutMs}ms (${url})`);
      }
      throw new Error(`plugin/${pkgName}: fetch failed (${url}): ${errorMessage(err)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

function makeScopedFetchJson(pkgName: string, scopedFetch: PluginRuntime["fetch"]): PluginRuntime["fetchJson"] {
  // Overloads mirror the protocol's: `T` is reachable only through
  // `opts.parse`, so un-validated JSON is never handed back as `T`.
  function fetchJson(url: string, opts?: PluginFetchOptions): Promise<unknown>;
  function fetchJson<T>(url: string, opts: PluginFetchJsonOptions<T>): Promise<T>;
  async function fetchJson(url: string, opts: PluginFetchOptions & { parse?: (raw: unknown) => unknown } = {}): Promise<unknown> {
    const response = await scopedFetch(url, opts);
    if (!response.ok) {
      throw new Error(`plugin/${pkgName}: fetchJson HTTP ${response.status} for ${url}`);
    }
    const raw: unknown = await response.json();
    return opts.parse ? opts.parse(raw) : raw;
  }
  return fetchJson;
}

// ─────────────────────────────────────────────────────────────────────
// Scoped pubsub publisher
// ─────────────────────────────────────────────────────────────────────

/** Build the channel name for a given plugin's event. Centralised so
 *  the server-side publish side and the browser-side subscribe side
 *  agree on the format (`plugin:<pkg>:<event>`). Exported for tests
 *  and for the browser runtime to import the same constant. */
export function pluginChannelName(pkgName: string, eventName: string): string {
  return `plugin:${pkgName}:${eventName}`;
}

function makeScopedPubSub(pkgName: string, hostPubSub: IPubSub): PluginRuntime["pubsub"] {
  return {
    publish(eventName, payload) {
      hostPubSub.publish(pluginChannelName(pkgName, eventName), payload);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped notifier (host extension over gui-chat-protocol's PluginRuntime)
// ─────────────────────────────────────────────────────────────────────

function makeScopedNotifier(pkgName: string): NotifierRuntimeApi {
  // Every method is plugin-scoped:
  //   - publish forces `pluginPkg` to the caller's pkg name (the
  //     plugin literally cannot publish under another's namespace).
  //   - update routes through `updateForPlugin` so a plugin can't
  //     mutate another plugin's entries. Silent no-op on cross-
  //     plugin id or validation failure.
  //   - clear routes through `clearForPlugin` so a plugin holding
  //     another plugin's id (e.g. via a future leak) silently no-ops
  //     instead of dismissing it. CodeRabbit review on PR #1198.
  //   - get returns the entry only if it belongs to this plugin;
  //     cross-plugin reads come back as `undefined`. Used for
  //     ghost-bell detection in `action`-lifecycle reconcilers.
  return {
    publish: (input) => notifierEngine.publish({ ...input, pluginPkg: pkgName }),
    update: (entryId, patch) => notifierEngine.updateForPlugin(pkgName, entryId, patch),
    clear: (entryId) => notifierEngine.clearForPlugin(pkgName, entryId),
    get: (entryId) => notifierEngine.getForPlugin(pkgName, entryId),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped tasks (host extension — Phase 1 of Encore plan)
// ─────────────────────────────────────────────────────────────────────

/** Build the registry id used for a plugin's tick. Centralised so the
 *  cap-at-1 closure check and the host task manager registration agree
 *  on the format. Exported for tests. */
export function pluginTaskId(pkgName: string): string {
  return `plugin:${pkgName}`;
}

function makeScopedTasks(pkgName: string, taskManager: ITaskManager): TasksRuntimeApi {
  // Cap-at-1 enforced at the runtime-API layer so the plugin author
  // sees a friendly message before the host task manager's generic
  // duplicate-id throw fires. The closure is per-plugin (each plugin
  // gets its own runtime), so `registered` cannot leak across
  // plugins.
  let registered = false;
  return {
    register(task) {
      if (registered) {
        throw new Error(`plugin/${pkgName}: already registered a task — only one tick per plugin is allowed`);
      }
      registered = true;
      taskManager.registerTask({
        id: pluginTaskId(pkgName),
        description: `tick for plugin ${pkgName}`,
        schedule: task.schedule,
        run: () => task.run(),
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped chat (host extension — Phase 1 of Encore plan)
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_PLUGIN_CHAT_ROLE = BUILTIN_ROLE_IDS.general;

function makeScopedChat(pkgName: string): ChatRuntimeApi {
  return {
    async start({ initialMessage, role }) {
      const roleId = role ?? DEFAULT_PLUGIN_CHAT_ROLE;
      const chatSessionId = randomUUID();
      const result = await startChat({
        message: initialMessage,
        roleId,
        chatSessionId,
        origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${pkgName}`,
      });
      if (result.kind === "error") {
        throw new Error(`plugin/${pkgName}: chat.start failed: ${result.error}`);
      }
      return { chatId: chatSessionId };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public entry — wire everything into one PluginRuntime
// ─────────────────────────────────────────────────────────────────────

export interface MakePluginRuntimeDeps {
  /** npm package name. Used both for sanitised fs segment + namespace prefix. */
  pkgName: string;
  /** Host pub/sub instance for fanning out scoped events. */
  pubsub: IPubSub;
  /** Locale tag the host has detected (e.g. `"ja"`). Snapshot only;
   *  reactive updates ride the frontend `BrowserPluginRuntime.locale`. */
  locale: string;
  /** Host task manager — backs `runtime.tasks.register()`. The same
   *  instance the host's own system tasks (journal, chat-index)
   *  register against. */
  taskManager: ITaskManager;
}

export function makePluginRuntime(deps: MakePluginRuntimeDeps): MulmoclaudeRuntime {
  const { pkgName, pubsub, locale, taskManager } = deps;
  const seg = sanitisePackageNameForFs(pkgName);
  const dataRoot = path.join(WORKSPACE_PATHS.pluginsData, seg);
  const configRoot = path.join(WORKSPACE_PATHS.pluginsConfig, seg);
  const scopedFetch = makeScopedFetch(pkgName);

  return {
    pubsub: makeScopedPubSub(pkgName, pubsub),
    locale,
    files: {
      data: makeConfinedFileOps(dataRoot),
      config: makeConfinedFileOps(configRoot),
      artifacts: makeArtifactsFileOps(),
    },
    log: makeScopedLogger(pkgName),
    fetch: scopedFetch,
    fetchJson: makeScopedFetchJson(pkgName, scopedFetch),
    // Host extensions over gui-chat-protocol's PluginRuntime. Plugin
    // authors access via `runtime as MulmoclaudeRuntime` for now.
    // Phase 3 of the Encore plan upstreams these into the protocol.
    notifier: makeScopedNotifier(pkgName),
    tasks: makeScopedTasks(pkgName, taskManager),
    chat: makeScopedChat(pkgName),
  };
}

// Re-export host's writeFileAtomic so plugin runtime tests can
// inspect the same primitive without reaching into utils/.
export { writeFileAtomic };

// Re-export logger type so the loader can type-check sink injection
// without re-importing from system/logger.
export type { Logger };
