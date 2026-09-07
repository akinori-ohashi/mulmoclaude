// Where `yarn dev`'s Vite proxy should send `/api` — the same port the backend
// binds (#2650).
//
// The backend honours `PORT`; Vite's proxy targets were literal `localhost:3001`.
// So `PORT=3100 yarn dev` moved only the server, and with a first instance still
// on 3001 the second browser silently rendered the FIRST instance's data — the
// proxy connects, it just connects to the wrong server.
//
// Every rule this needs is BORROWED, never re-implemented, because a second
// opinion about `PORT` is the same bug one level down:
//   - the numeric coercion and range come from `server/utils/envCoerce.ts`, the
//     module `server/system/env.ts` itself uses (so `0x1f`, `1e3`, `+3100`,
//     `3100.0` resolve here exactly as the backend resolves them);
//   - the `.env` VALUES are supplied by the caller, parsed with the launcher's
//     `parseEnvFile` — i.e. `dotenv.parse`, what the server's loader uses;
//   - which of the two WINS comes from the launcher's `mergeLaunchEnv`, the same
//     no-override merge `server/system/envFile.ts` applies. That one matters more
//     than it looks: the shell shadows `.env` whenever `PORT` is merely PRESENT,
//     so a shell `PORT=nonsense` sends the backend to the default and must not
//     let the proxy pick up `.env`'s value instead (Codex, #2653).
//
// This file only reads the winning value and reports what it cannot follow.
import { asInt, DEFAULT_PORT, PORT_RANGE } from "../../server/utils/envCoerce.js";
import { mergeLaunchEnv } from "../../server/utils/launch-env.mjs";

export const DEFAULT_SERVER_PORT = DEFAULT_PORT;

// Outside the backend's own range, so "the backend would ignore this" is
// distinguishable from "the backend would use this".
const NOT_A_PORT = -1;

/** Why a value could not be used as a proxy target. */
export type PortRejection = "ignored-by-server" | "ephemeral";

export interface PortProblem {
  source: string;
  raw: string;
  reason: PortRejection;
}

export interface ParsedPort {
  port: number | null;
  reason?: PortRejection;
}

/**
 * The port the backend would bind for `raw`, or `null` with the reason it cannot
 * be a proxy target.
 *
 * `0` is the interesting case: the backend accepts it (`PORT_RANGE.min` is 0) and
 * asks the OS for an ephemeral port. Nothing evaluated at Vite-config time can
 * know which one, so it is named rather than quietly mapped to the default.
 * `Number("   ")` is also 0, so a whitespace-only value lands here too.
 */
export const parseServerPort = (raw: string | undefined | null): ParsedPort => {
  const coerced = asInt(raw ?? undefined, NOT_A_PORT, PORT_RANGE);
  if (coerced === NOT_A_PORT) return { port: null, reason: "ignored-by-server" };
  if (coerced === 0) return { port: null, reason: "ephemeral" };
  return { port: coerced };
};

export interface ServerPortSources {
  processEnv?: Record<string, string | undefined>;
  /** `.env` as the launcher's `parseEnvFile` parsed it — NOT raw file text.
   *  Values are strings: `dotenv.parse` never yields `undefined`. */
  envFileValues?: Record<string, string> | null;
}

export interface PortResolution {
  /** The port to proxy to. Meaningless if `problems` contains an `ephemeral` one. */
  port: number;
  /** Every value that was present but unusable, in the order they were consulted. */
  problems: PortProblem[];
}

// The server's own definition of "set" (`asInt` falls back for `undefined` and `""`).
// Anything else IS a value it coerces, so anything else is worth reporting —
// including `"   "`, which coerces to 0 and would otherwise be refused in silence.
// A type guard so the reported `raw` is known to be a string.
const isSet = (raw: string | undefined): raw is string => raw !== undefined && raw !== "";

/**
 * The port the backend will bind, resolved through the server's own precedence.
 *
 * `mergeLaunchEnv` decides the winner rather than a rule written here: `.env`
 * applies only when the shell has no `PORT` key at all, so `PORT=""` and
 * `PORT=nonsense` both send the backend to the default WITHOUT consulting the
 * file. A resolver that "kept looking" after an unusable shell value would target
 * `.env`'s port while the backend sat on 3001 — the same split, one branch over.
 */
export const resolveServerPort = (sources: ServerPortSources = {}): PortResolution => {
  const processEnv = sources.processEnv ?? {};
  const { env, loadedKeys } = mergeLaunchEnv(processEnv, sources.envFileValues ?? {});
  const raw: string | undefined = env.PORT;
  const source = loadedKeys.includes("PORT") ? ".env PORT" : "PORT";

  const { port, reason } = parseServerPort(raw);
  if (port !== null) return { port, problems: [] };
  const problems: PortProblem[] = isSet(raw) && reason ? [{ source, raw, reason }] : [];
  return { port: DEFAULT_SERVER_PORT, problems };
};

/** Human-readable cause, so the dev console says what to do about it. */
export const describeRejection = (reason: PortRejection): string =>
  reason === "ephemeral" ? "0 asks the OS for an ephemeral port, which nothing at config time can know" : "not a port the server would accept";

/**
 * Refuse to start the dev server when the backend's port is unknowable.
 *
 * A warning is not enough for the `ephemeral` case: the proxy would fall through
 * to another source or to `:3001`, the page would load, and the client would be
 * talking to whatever else is listening there — the exact silent mis-wiring this
 * module exists to prevent. Better to stop with the reason (Codex, #2653).
 *
 * Only the dev server cares: `PORT` means nothing to `vite build`, so the caller
 * applies this on `serve` alone.
 */
export const assertProxyablePort = (resolution: PortResolution, target?: ProxyTarget): void => {
  // A published port is knowable by definition — the backend is on it and said
  // so — which is what makes `PORT=0` usable now (#2981). The refusal below is
  // for the case it was written for: nothing published, so the proxy would fall
  // through to `:3001` and quietly reach whatever else is there.
  if (target?.source === "published") return;
  const ephemeral = resolution.problems.find((problem) => problem.reason === "ephemeral");
  if (!ephemeral) return;
  throw new Error(
    `${ephemeral.source}="${ephemeral.raw}" makes the backend take an OS-assigned port, ` +
      `which the dev proxy cannot target — the client would silently reach a different server. ` +
      `Set an explicit port (e.g. PORT=3100) to run \`yarn dev\`.`,
  );
};

/** Where the proxy target came from. `published` means the backend told us. */
export type ProxyTargetSource = "published" | "env";

export interface ProxyTarget {
  port: number;
  source: ProxyTargetSource;
}

/**
 * The backend writes a bare integer plus a newline. Anything else — an empty
 * file, a half-finished write, a build too old to publish at all — is not a
 * port and must fall back rather than resolve to `NaN` or `0`.
 *
 * `parseServerPort` rather than a numeric check written here: the same rule that
 * decides what the backend would accept decides what counts as a published port,
 * which is this module's whole reason for existing. It already returns `null`
 * for both unusable text and `0`.
 */
export const parsePublishedPort = (raw: string | null): number | null => {
  if (raw === null) return null;
  return parseServerPort(raw.trim()).port;
};

/**
 * The port the dev proxy should address (#2981).
 *
 * `PORT` says what the backend was ASKED for; `.server-port` says what it
 * actually bound. Those differ exactly when the request could not be honoured —
 * an implicit default that was busy, which `server/index.ts` deliberately walks
 * forward from — and that gap is #2650: the client kept addressing the port
 * nobody was on.
 *
 * So the published value wins whenever there is one. It is not a heuristic: the
 * backend writes it after `app.listen` with the port it is actually serving, and
 * `yarn dev` clears the file before either pane starts so a leftover cannot be
 * mistaken for this run's. `PORT` remains the answer only when nothing has been
 * published — a client started without a backend, or one that never came up.
 */
export const resolveProxyTarget = (publishedRaw: string | null, resolution: PortResolution): ProxyTarget => {
  const published = parsePublishedPort(publishedRaw);
  if (published !== null) return { port: published, source: "published" };
  return { port: resolution.port, source: "env" };
};


/**
 * The proxy targets, built from one port so the five entries cannot drift apart.
 *
 * `127.0.0.1`, not `localhost`: the backend binds the IPv4 loopback explicitly
 * (`app.listen(port, "127.0.0.1")`), while `localhost` resolves to `::1` first
 * on a dual-stack host. Usually that still works — nothing holds `::1:3001`, the
 * connection is refused and Node falls back to IPv4 — but when something IS
 * there, the proxy connects to it and never falls back, so the client silently
 * talks to a different server on the same port number. Observed while verifying
 * #2981: with an unrelated process on `*:3002` and this backend on
 * `127.0.0.1:3002`, `localhost:3002` answered 404 and `127.0.0.1:3002` answered
 * 200. Naming the address the backend actually bound removes the ambiguity.
 */
export const serverOrigins = (port: number): { http: string; ws: string } => ({
  http: `http://127.0.0.1:${port}`,
  ws: `ws://127.0.0.1:${port}`,
});
