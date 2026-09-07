// Unit tests for the MCP broker's startup beacon (#2842).
//
// The beacon is the only path by which the broker's cold-boot timing reaches
// the host: Claude CLI spawns the broker and owns its stderr. So what these
// pin is the observability contract — a slow boot must read as a warn, and the
// recorded reading must be retrievable when the turn later fails, because
// "never came up" vs "came up late" is the distinction #2842 could not make.
//
// Same pattern as test_hookLog.ts: pull the handler out of the Router stack
// and call it with mock req/res, no live server involved.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, Router } from "express";
import mcpBrokerReadyRoutes from "../../../server/api/routes/mcpBrokerReady.js";
import {
  BROKER_SLOW_BOOT_MS,
  beginBrokerSpawn,
  getBrokerReady,
  getCurrentBrokerSpawn,
  getBrokerStarted,
  _resetBrokerReadiness,
} from "../../../server/agent/brokerReadiness.js";
import { log } from "../../../server/system/logger/index.js";
import { ONE_HOUR_MS } from "../../../server/utils/time.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

interface LogCall {
  level: "info" | "warn";
  namespace: string;
  message: string;
  data?: object | undefined;
}

const captured: LogCall[] = [];
const originalInfo = log.info;
const originalWarn = log.warn;
const originalDebug = log.debug;

interface RouterInternals {
  stack: { route?: { path: string; stack: { handle: (req: Request, res: Response) => void }[] } }[];
}

function getPostHandler(router: Router, path: string): (req: Request, res: Response) => void {
  const internals = router as unknown as RouterInternals;
  for (const layer of internals.stack) {
    if (layer.route && layer.route.path === path) {
      const [first] = layer.route.stack;
      if (first) return first.handle;
    }
  }
  throw new Error(`POST ${path} handler not found in router stack`);
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  end: () => MockResponse;
}

function mockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

async function postTo(path: string, session: unknown, body: unknown): Promise<MockResponse> {
  const handler = getPostHandler(mcpBrokerReadyRoutes, path);
  const req = { body, query: { session } } as unknown as Request;
  const res = mockResponse();
  await Promise.resolve(handler(req, res as unknown as Response));
  return res;
}

const post = (session: unknown, body: unknown): Promise<MockResponse> => postTo(API_ROUTES.mcp.brokerReady, session, body);
const postStarting = (session: unknown, body: unknown): Promise<MockResponse> => postTo(API_ROUTES.mcp.brokerStarting, session, body);

const SPAWN = "spawn-1";
const fastBoot = { bootMs: 120, initializeMs: 180, kind: "bundle", spawnId: SPAWN } as const;

/** Register the spawn the host is waiting on, the way `runAgent` does before
 *  the broker can possibly report in. */
function armSpawn(sessionId: string, spawnId = SPAWN): void {
  beginBrokerSpawn(sessionId, spawnId, "bundle");
}

/** The reading for whichever spawn is current — how the recovery path starts,
 *  before it pins the rest of its question to that spawn's id. */
const currentReady = (sessionId: string) => getCurrentBrokerSpawn(sessionId)?.ready ?? null;

describe("POST /api/mcp/broker-ready", () => {
  beforeEach(() => {
    captured.length = 0;
    _resetBrokerReadiness();
    log.info = (namespace, message, data) => {
      captured.push({ level: "info", namespace, message, data });
    };
    log.warn = (namespace, message, data) => {
      captured.push({ level: "warn", namespace, message, data });
    };
  });

  afterEach(() => {
    log.info = originalInfo;
    log.warn = originalWarn;
    _resetBrokerReadiness();
  });

  it("records the reading against the session and logs it at info", async () => {
    armSpawn("chat-1");
    const res = await post("chat-1", fastBoot);
    assert.equal(res.statusCode, 204);
    assert.deepEqual(currentReady("chat-1"), { bootMs: 120, initializeMs: 180, kind: "bundle" });
    const [entry] = captured;
    assert.ok(entry);
    assert.equal(entry.level, "info");
    assert.equal(entry.namespace, "mcp");
  });

  // The point of the whole beacon: a turn that later dies on
  // `handlePermission not found` can ask whether the broker EVER answered.
  it("leaves an untouched session with no reading", async () => {
    armSpawn("chat-1");
    await post("chat-1", fastBoot);
    assert.equal(currentReady("chat-2"), null);
  });

  it("warns instead of infos once the boot crosses the slow threshold", async () => {
    armSpawn("chat-slow");
    await post("chat-slow", { bootMs: BROKER_SLOW_BOOT_MS, initializeMs: BROKER_SLOW_BOOT_MS + 10, kind: "tsx", spawnId: SPAWN });
    const [entry] = captured;
    assert.ok(entry);
    assert.equal(entry.level, "warn");
  });

  it("rejects a beacon with no session to attribute it to", async () => {
    assert.equal((await post(undefined, fastBoot)).statusCode, 400);
    assert.equal((await post("", fastBoot)).statusCode, 400);
    assert.equal(captured.length, 0);
  });

  // A number we cannot trust is worse than no number: it would be read later
  // as a measurement and steer the connect-wait tuning it exists to inform.
  it("rejects durations that are negative, absurd, or not numbers", async () => {
    assert.equal((await post("s", { ...fastBoot, bootMs: -1 })).statusCode, 400);
    assert.equal((await post("s", { ...fastBoot, initializeMs: Number.POSITIVE_INFINITY })).statusCode, 400);
    assert.equal((await post("s", { ...fastBoot, bootMs: "120" })).statusCode, 400);
    assert.equal((await post("s", { ...fastBoot, bootMs: ONE_HOUR_MS })).statusCode, 400);
    assert.equal(currentReady("s"), null);
  });

  it("rejects an unknown broker kind rather than recording it", async () => {
    assert.equal((await post("s", { ...fastBoot, kind: "deno" })).statusCode, 400);
    assert.equal((await post("s", { bootMs: 1, initializeMs: 2 })).statusCode, 400);
    assert.equal(currentReady("s"), null);
  });

  // Codex review on #2898. The key is the CHAT session, stable for the life of
  // a conversation, but each turn spawns its own broker — so without a reset at
  // spawn, turn 1's beacon answers for turn 5's broker that never started,
  // reporting `brokerEverReady: true` in precisely the case the field exists to
  // catch.
  //
  // Driven through `beginBrokerSpawn` rather than `clearBrokerReady` on purpose:
  // that is the function `runAgent` actually calls, and it is the one that also
  // produces the spawn log's `broker` field — so a future edit cannot keep the
  // logging while dropping the reset and still pass this.
  it("does not let one turn's beacon vouch for a later turn's broker", async () => {
    armSpawn("chat-1");
    await post("chat-1", fastBoot);
    assert.ok(currentReady("chat-1"), "precondition: turn 1 recorded a beacon");

    assert.equal(beginBrokerSpawn("chat-1", "spawn-2", "bundle"), "bundle");
    assert.equal(currentReady("chat-1"), null, "turn 2's spawn must start with no beacon on record");
  });

  // Codex review iter-4, and the sharper version of the same problem. The 3 s
  // broker retry replaces the attempt; a straggler beacon from the FAILED
  // attempt then arrives under the same chat session. Clearing at spawn does
  // not help — the straggler lands after the clear. And this is not a remote
  // possibility: the failure being diagnosed IS "the broker was too slow", so
  // a late beacon is correlated with exactly the case that matters.
  it("ignores a beacon from the attempt that was already replaced", async () => {
    armSpawn("chat-retry", "attempt-1");
    const replaced = await post("chat-retry", { ...fastBoot, spawnId: "attempt-1" });
    assert.equal(replaced.statusCode, 204, "precondition: attempt 1 could report");

    armSpawn("chat-retry", "attempt-2"); // the retry respawns
    const straggler = await post("chat-retry", { ...fastBoot, bootMs: 55_000, initializeMs: 55_100, spawnId: "attempt-1" });

    assert.equal(straggler.statusCode, 204, "a straggler is not the sender's fault");
    assert.equal(currentReady("chat-retry"), null, "attempt 1's beacon must not vouch for attempt 2");
    assert.ok(
      captured.some((entry) => entry.message.includes("superseded")),
      `the discard should still be logged, got: ${captured.map((entry) => entry.message).join(" | ")}`,
    );
  });

  it("still records the beacon that does belong to the current attempt", async () => {
    armSpawn("chat-retry", "attempt-2");
    await post("chat-retry", { ...fastBoot, spawnId: "attempt-2" });
    assert.deepEqual(currentReady("chat-retry"), { bootMs: 120, initializeMs: 180, kind: "bundle" });
  });

  it("rejects a beacon that names no spawn at all", async () => {
    armSpawn("chat-3");
    assert.equal((await post("chat-3", { bootMs: 1, initializeMs: 2, kind: "bundle" })).statusCode, 400);
    assert.equal(currentReady("chat-3"), null);
  });

  it("reports no broker, and still resets, when the turn runs without MCP", async () => {
    armSpawn("chat-2");
    await post("chat-2", fastBoot);
    assert.equal(beginBrokerSpawn("chat-2", "spawn-2", null), "none");
    assert.equal(currentReady("chat-2"), null);
  });
});

// The start beacon answers a different question from the ready beacon, and the
// difference is the whole point: "did the process exist" vs "did it finish
// booting". Measuring against a broker that never launched showed the CLI
// surfaces that within seconds on its own — so this exists to tell the two
// failures apart in the log, not to act on them.
describe("POST /api/mcp/broker-starting", () => {
  beforeEach(() => {
    captured.length = 0;
    _resetBrokerReadiness();
    log.debug = (namespace, message, data) => {
      captured.push({ level: "info", namespace, message, data });
    };
  });

  afterEach(() => {
    log.debug = originalDebug;
    _resetBrokerReadiness();
  });

  it("records that the process exists", async () => {
    armSpawn("chat-start");
    const res = await postStarting("chat-start", { spawnId: SPAWN });
    assert.equal(res.statusCode, 204);
    assert.equal(getBrokerStarted("chat-start", SPAWN), true);
  });

  // Started is not ready: a broker can announce itself and then never finish
  // loading, which is a different diagnosis with a different fix.
  it("does not imply readiness", async () => {
    armSpawn("chat-start");
    await postStarting("chat-start", { spawnId: SPAWN });
    assert.equal(currentReady("chat-start"), null);
  });

  // A straggler from the attempt that just failed must not vouch for the one
  // replacing it — the same spawn-id gate the ready beacon uses.
  it("ignores a beacon from a superseded spawn", async () => {
    armSpawn("chat-start", "spawn-2");
    const res = await postStarting("chat-start", { spawnId: "spawn-1" });
    assert.equal(res.statusCode, 204);
    assert.equal(getBrokerStarted("chat-start", SPAWN), false);
  });

  it("reports false for a session nothing was ever recorded against", () => {
    assert.equal(getBrokerStarted("never-seen", SPAWN), false);
  });

  it("rejects a missing session", async () => {
    const res = await postStarting(undefined, { spawnId: SPAWN });
    assert.equal(res.statusCode, 400);
  });

  it("rejects a missing or non-string spawn id", async () => {
    armSpawn("chat-start");
    assert.equal((await postStarting("chat-start", {})).statusCode, 400);
    assert.equal((await postStarting("chat-start", { spawnId: 7 })).statusCode, 400);
    assert.equal((await postStarting("chat-start", { spawnId: "" })).statusCode, 400);
    assert.equal(getBrokerStarted("chat-start", SPAWN), false);
  });

  // A new spawn clears the previous one's answer, or a replay would inherit
  // the failed attempt's evidence.
  it("is cleared by the next spawn", async () => {
    armSpawn("chat-start", "spawn-1");
    await postStarting("chat-start", { spawnId: "spawn-1" });
    assert.equal(getBrokerStarted("chat-start", "spawn-1"), true);
    armSpawn("chat-start", "spawn-2");
    assert.equal(getBrokerStarted("chat-start", "spawn-2"), false);
  });

  // The reverse direction, and the reason the lookup takes a spawn id at all: a
  // replay starts a second broker for the SAME session moments after the first
  // turn failed. Asking per-session would let the healthy second spawn vouch
  // for the attempt that already died — the diagnosis exactly backwards (Codex
  // review on #2932).
  it("does not let a later spawn vouch for an earlier one", async () => {
    armSpawn("chat-start", "spawn-1");
    // spawn-1's broker never announces itself; the turn fails and is replayed.
    armSpawn("chat-start", "spawn-2");
    await postStarting("chat-start", { spawnId: "spawn-2" });
    assert.equal(getBrokerStarted("chat-start", "spawn-2"), true);
    assert.equal(getBrokerStarted("chat-start", "spawn-1"), false);
  });

  // The READY beacon needs the same scoping, and for the same reason. The
  // failure diagnosis runs after the CLI exits, by which time the replay's
  // broker may already have reported ready — a session-keyed read would let it
  // suppress the diagnostic for the attempt that actually failed (Codex review
  // on #2932).
  it("answers readiness for the named spawn, not whichever spawn is current", async () => {
    armSpawn("chat-overlap", "spawn-1");
    armSpawn("chat-overlap", "spawn-2");
    await post("chat-overlap", { ...fastBoot, spawnId: "spawn-2" });

    assert.notEqual(getBrokerReady("chat-overlap", "spawn-2"), null);
    assert.equal(getBrokerReady("chat-overlap", "spawn-1"), null, "the replacement must not vouch for the attempt it replaced");
  });

  // The recovery path asks a different question — "the spawn we are waiting
  // on" — because the turn's own spawn id never leaves `runAgent`.
  it("reports the current spawn's reading for the recovery path", async () => {
    armSpawn("chat-current", "spawn-1");
    await post("chat-current", { ...fastBoot, spawnId: "spawn-1" });
    assert.notEqual(currentReady("chat-current"), null);
    armSpawn("chat-current", "spawn-2");
    assert.equal(currentReady("chat-current"), null, "the replacement starts with no reading of its own");
  });

  // …and having read WHICH spawn that is, it asks about that one for the rest
  // of the wait. `beginRun` already refuses a second run per chat session, so
  // no other spawn can appear mid-wait today — but the gate lives elsewhere and
  // could move, and a diagnosis that is only correct because of a distant
  // invariant is one nobody can check (Codex review on #2932).
  it("pins the recovery question to the spawn it started with", async () => {
    armSpawn("chat-pinned", "spawn-1");
    const spawn = getCurrentBrokerSpawn("chat-pinned");
    assert.equal(spawn?.spawnId, "spawn-1");

    // A later spawn reports ready while the wait is still running.
    armSpawn("chat-pinned", "spawn-2");
    await post("chat-pinned", { ...fastBoot, spawnId: "spawn-2" });

    assert.equal(getBrokerReady("chat-pinned", spawn?.spawnId ?? ""), null, "spawn-2's beacon must not answer for spawn-1");
    assert.notEqual(currentReady("chat-pinned"), null, "and it is still the current spawn's own reading");
  });
});
