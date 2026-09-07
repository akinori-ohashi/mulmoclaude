// Delivering the MCP broker's startup beacon (#2842).
//
// The beacon used to be a single fire-and-forget POST: any transient failure —
// a 2 s timeout against a busy host, a connection reset — dropped it for good.
// That was tolerable while it only decorated a warn.
//
// It is not tolerable now that the host DECIDES on it: a beacon lost in flight
// reads as "the broker never came up", which is the reading that skips the
// replay. Retrying is what keeps a delivery failure from being mistaken for a
// broker failure.

export interface BeaconDelivery {
  /** One delivery attempt, bounded by the `timeoutMs` it is handed. Must reject
   *  on a timeout, on a network error, AND on an HTTP failure — the budget
   *  below is only meaningful if an attempt cannot outlast its timeout. Passed
   *  in rather than read from the policy by the sender, so a sender cannot
   *  quietly stop honouring it. */
  send: (timeoutMs: number) => Promise<unknown>;
  /** Pause between attempts. Injected so a test spends no real time. */
  wait: (delayMs: number) => Promise<void>;
  /** Called once, with the final error, when every attempt failed. */
  report: (attempts: number, error: unknown) => void;
}

export interface BeaconRetryPolicy {
  attempts: number;
  retryDelayMs: number;
  /** How long one attempt may take before it counts as failed. */
  timeoutMs: number;
}

/** How the broker delivers its startup beacon.
 *
 *  Short per-attempt timeout, tried repeatedly, rather than one patient
 *  attempt: the retry is what survives a momentarily busy host, and a long
 *  timeout only delays the retry that would have worked. Timeliness matters
 *  because the host is waiting on this to decide whether the turn is worth
 *  replaying.
 *
 *  Exported as one object because the host's decision window is defined
 *  against its TOTAL budget — see `beaconDeliveryBudgetMs`. */
export const BROKER_READY_DELIVERY: BeaconRetryPolicy = {
  attempts: 3,
  retryDelayMs: 500,
  timeoutMs: 2000,
};

/** Longest a delivery can take before every attempt has failed: each attempt
 *  may burn its whole timeout, with a pause between them.
 *
 *  The host must not conclude "no beacon, so the broker never came up" before
 *  this has elapsed — until then, an absent beacon is equally consistent with
 *  one still in flight, and refusing the replay on that reading breaks the
 *  #2057 recovery (Codex review on #2931). */
export function beaconDeliveryBudgetMs(policy: BeaconRetryPolicy): number {
  // Nothing is sent below one attempt, so nothing is spent. Without this the
  // arithmetic returns a NEGATIVE duration, which any window would then satisfy
  // — the one comparison this function exists for (CodeRabbit review on #2931).
  if (policy.attempts < 1) return 0;
  return policy.attempts * policy.timeoutMs + (policy.attempts - 1) * policy.retryDelayMs;
}

/** Send until an attempt succeeds or the budget runs out, and report which.
 *
 *  Never rejects: the only caller is the `initialize` handler, which fires this
 *  and moves on — a rejection there becomes an unhandled rejection in the
 *  broker rather than a logged beacon failure, which is a worse outcome than
 *  any beacon is worth.
 *
 *  "Never" is enforced at the boundary rather than argued call by call. Only
 *  `send` is caught inside the loop, because only its failure means "retry";
 *  `wait` and `report` throwing mean the beacon is not going to be delivered,
 *  which is what `false` already says. Containing it in one place also means a
 *  later edit inside the loop cannot quietly reintroduce the escape — the
 *  reporter is the real risk, since it writes to a stderr pipe Claude CLI owns
 *  and a CLI that has already exited turns that write into an EPIPE throw. */
export async function deliverBeacon(delivery: BeaconDelivery, policy: BeaconRetryPolicy): Promise<boolean> {
  if (policy.attempts < 1) return false;

  const attempt = async (remaining: number): Promise<boolean> => {
    try {
      await delivery.send(policy.timeoutMs);
      return true;
    } catch (err) {
      if (remaining <= 1) {
        delivery.report(policy.attempts, err);
        return false;
      }
      await delivery.wait(policy.retryDelayMs);
      return attempt(remaining - 1);
    }
  };

  return attempt(policy.attempts).catch(() => false);
}
