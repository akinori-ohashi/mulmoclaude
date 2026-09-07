// Which agent-stream failures are worth replaying, and how long to wait first.
//
// Both recoveries replay a turn that produced no side effects — a stale
// `--resume` id is rejected before the CLI runs anything, and the broker race
// fails on the FIRST tool call. Widening either predicate to an error that can
// fire mid-turn would replay work that already happened.

import { isStaleSessionError } from "./resumeFailover.js";
import { isMcpBrokerNotReadyError } from "./mcpBrokerFailover.js";
import { ONE_SECOND_MS } from "../utils/time.js";
import { EVENT_TYPES } from "../../src/types/events.js";

/** How long to let the broker finish connecting before replaying (#2057). The
 *  forensics show it comes up a few seconds after losing the race. */
export const BROKER_RECONNECT_WAIT_MS = 3 * ONE_SECOND_MS;

/** How long the host keeps looking for the startup beacon before concluding it
 *  is not coming.
 *
 *  MUST exceed the beacon's own delivery budget (`beaconDeliveryBudgetMs`).
 *  Until delivery has run out of attempts, an absent beacon is equally
 *  consistent with one still in flight — and refusing the replay on that
 *  reading would break the #2057 recovery for a broker that DID answer
 *  `initialize`, which is the opposite of what this feature is for (Codex
 *  review on #2931). A test pins the inequality.
 *
 *  Only the give-up path waits this long. A beacon that arrives decides
 *  immediately, so the replay path still costs `BROKER_RECONNECT_WAIT_MS`. */
export const BROKER_READY_DECISION_WINDOW_MS = 8 * ONE_SECOND_MS;

/** Why the broker replay was taken or refused. Goes straight into the log line,
 *  so the three failures that produce one identical CLI error are separable
 *  from the outside — the ambiguity #2842 was filed against. */
export type BrokerReplayReason = "ready-before-wait" | "ready-during-wait" | "never-ready";

export interface BrokerReplayVerdict {
  replay: boolean;
  reason: BrokerReplayReason;
}

/** Decide whether replaying the turn can plausibly succeed, from the startup
 *  beacon (#2898) read on BOTH sides of the reconnect wait.
 *
 *  Reading it only BEFORE the wait would break the recovery the wait exists
 *  for: the beacon is sent when the broker answers `initialize`, so a broker
 *  that lost the race by a moment has not sent one yet at the instant the turn
 *  fails. That is #2057, and it is fixed by replaying. Reading it again after
 *  the wait is what tells that case apart from #2842's, where nothing ever
 *  arrives and the replay only buys a second full connect-wait before the same
 *  error.
 *
 *  `readyBeforeWait` without `readyAfterWait` cannot happen — readiness is
 *  recorded per spawn and only a new spawn clears it — but it is answered
 *  rather than assumed away, because "the broker DID answer" is the safe
 *  reading either way: a replay costs latency, refusing one costs the turn. */
export function judgeBrokerReplay(readyBeforeWait: boolean, readyAfterWait: boolean): BrokerReplayVerdict {
  if (readyBeforeWait) return { replay: true, reason: "ready-before-wait" };
  if (readyAfterWait) return { replay: true, reason: "ready-during-wait" };
  return { replay: false, reason: "never-ready" };
}

export type RecoveryKind = "stale" | "broker" | null;

export interface RetryBudgets {
  stale: number;
  broker: number;
}

interface StreamEvent {
  type: string;
  message?: unknown;
  recovery?: unknown;
}

/** A stale `--resume` failure we can recover from by retrying without it: an
 *  error event carrying a stale-session message, while failover budget remains. */
export function isRecoverableStaleSession(event: StreamEvent, attemptsRemaining: number): boolean {
  if (attemptsRemaining <= 0 || event.type !== EVENT_TYPES.error || typeof event.message !== "string") return false;
  return event.recovery === "stale-session" || isStaleSessionError(event.message);
}

/** The transient MCP-broker startup race (#2057): the CLI couldn't resolve the
 *  permission-prompt tool because the broker's stdio wasn't connected when the
 *  first tool call ran. Recoverable by waiting a moment and replaying the SAME
 *  turn — nothing executed, the first tool call is what failed. Hits fresh
 *  sessions too, so it carries a budget independent of `--resume`. */
export function isRecoverableBrokerNotReady(event: StreamEvent, attemptsRemaining: number): boolean {
  return attemptsRemaining > 0 && event.type === EVENT_TYPES.error && typeof event.message === "string" && isMcpBrokerNotReadyError(event.message);
}

/** Classify an event into the one recovery it warrants, or null. Budgets are
 *  consumed by the caller after a successful classification. */
export function detectRecovery(event: StreamEvent, budgets: RetryBudgets): RecoveryKind {
  if (isRecoverableStaleSession(event, budgets.stale)) return "stale";
  if (isRecoverableBrokerNotReady(event, budgets.broker)) return "broker";
  return null;
}

/** Abortable wait so a stop during the retry pause ends promptly instead of
 *  spawning a doomed replay after the user already cancelled. */
export const abortableSleep = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    // Detached on BOTH exits. `{ once: true }` only releases the listener if the
    // abort actually fires, so a sleep that simply finished used to leave one
    // behind — measured at one per call on the same signal, which the readiness
    // poll turns into 32 over its window (CodeRabbit review on #2931).
    // Registered against its OWN signal so it detaches on EITHER exit. `{ once:
    // true }` alone releases the listener only when the abort actually fires, so
    // a sleep that simply finished used to leave one behind — one per call on
    // the same signal, which the readiness poll turns into ~32 over its window
    // (CodeRabbit review on #2931).
    const registration = new AbortController();
    const timer = setTimeout(() => {
      registration.abort();
      resolve();
    }, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true, signal: registration.signal },
    );
  });

/** How often readiness is re-read while waiting. The beacon lands in an HTTP
 *  handler on another task, so there is nothing to await — but the wait is
 *  bounded and rare (only a failed turn reaches it), so polling costs nothing
 *  a subscription would save. */
const BROKER_READY_POLL_MS = 250;

/** Wait until `readReady` answers, the window closes, or the turn is aborted.
 *
 *  `readReady` is injected rather than imported so the policy stays testable
 *  without the readiness module's process-wide state. */
export async function awaitBrokerReady<T>(readReady: () => T | null, windowMs: number, signal: AbortSignal): Promise<T | null> {
  const deadline = Date.now() + windowMs;
  const poll = async (): Promise<T | null> => {
    const ready = readReady();
    if (ready !== null) return ready;
    if (signal.aborted || Date.now() >= deadline) return null;
    await abortableSleep(BROKER_READY_POLL_MS, signal);
    return poll();
  };
  return poll();
}
