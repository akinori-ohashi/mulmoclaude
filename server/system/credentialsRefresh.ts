import { log } from "./logger/index.js";
import { ONE_SECOND_MS } from "../utils/time.js";
import { makeSharedRun } from "../utils/sharedRun.js";
import { classifyCredentials, NO_RENEWAL_FAILURES, recordRenewal, renewalDecision, type RenewalHistory } from "./credentialsState.js";

/** The side effects a refresh needs; injected so the "never launch a billed
 *  renewal that cannot succeed" wiring is testable without a Keychain. */
export interface CredentialsRefreshIo {
  readKeychain: () => Promise<string | null>;
  /** Launch the `claude` CLI to renew — a billed session. True when it responded. */
  renewViaCli: () => Promise<boolean>;
  writeCredentials: (credentials: string) => Promise<void>;
  nowMs: () => number;
}

interface RefreshContext {
  refreshIo: CredentialsRefreshIo;
  history: RenewalHistory;
}

const RELOGIN_HINT = "Run `claude /login` on the host; MulmoClaude picks the new login up on the next turn.";

/** Renew through the CLI and re-read the Keychain; the fresh blob, or null
 *  when the renewal did not produce a valid token. */
async function renewAndReread({ refreshIo }: RefreshContext): Promise<string | null> {
  if (!(await refreshIo.renewViaCli())) {
    log.error("credentials", "Token renewal via claude CLI failed");
    return null;
  }
  const credentials = await refreshIo.readKeychain();
  // The PTY check is a proxy for "Claude responded", not proof that the Keychain entry was refreshed.
  const verdict = credentials === null ? null : classifyCredentials(credentials, refreshIo.nowMs());
  if (verdict?.kind !== "valid") {
    log.error("credentials", `Keychain still has no valid token after renewal (${verdict?.kind ?? "missing"})`);
    return null;
  }
  log.info("credentials", "Token renewed successfully via claude CLI");
  return credentials;
}

/** A throw still counts as a failed attempt; otherwise it would slip past the cap on every call. */
async function renewAndRereadOrNull(context: RefreshContext): Promise<string | null> {
  try {
    return await renewAndReread(context);
  } catch (err) {
    log.error("credentials", "Token renewal threw", { error: String(err) });
    return null;
  }
}

function canAttemptRenewal(context: RefreshContext): boolean {
  const decision = renewalDecision(context.history, context.refreshIo.nowMs());
  if (decision.kind === "attempt") return true;
  if (decision.kind === "cooldown") {
    log.warn("credentials", `Access token expired; last renewal failed, next attempt in ${Math.ceil(decision.retryInMs / ONE_SECOND_MS)}s`);
  } else {
    log.debug("credentials", "Access token expired; renewal given up for this process");
  }
  return false;
}

function describeExpiry(expiresMs: number | null): string {
  return expiresMs === null ? "(no usable expiry)" : `at ${new Date(expiresMs).toISOString()}`;
}

async function renewExpired(context: RefreshContext, expiresMs: number | null): Promise<boolean> {
  if (!canAttemptRenewal(context)) return false;
  log.warn("credentials", `Access token expired ${describeExpiry(expiresMs)}, launching claude CLI to renew...`);
  const credentials = await renewAndRereadOrNull(context);
  context.history = recordRenewal(context.history, credentials !== null, context.refreshIo.nowMs());
  if (credentials === null) {
    if (renewalDecision(context.history, context.refreshIo.nowMs()).kind === "exhausted") {
      log.error("credentials", `Token renewal failed ${context.history.consecutiveFailures} times in a row; not trying again. ${RELOGIN_HINT}`);
    }
    return false;
  }
  await context.refreshIo.writeCredentials(credentials);
  return true;
}

async function exportCredentials(context: RefreshContext, credentials: string): Promise<boolean> {
  const verdict = classifyCredentials(credentials, context.refreshIo.nowMs());
  if (verdict.kind === "unusable") {
    log.error("credentials", `Keychain credentials cannot be renewed (${verdict.reason}). ${RELOGIN_HINT}`);
    return false;
  }
  if (verdict.kind === "expired") return renewExpired(context, verdict.expiresMs);
  // A valid token means the user logged in again, so earlier failures no longer apply.
  context.history = NO_RENEWAL_FAILURES;
  log.info("credentials", `Access token is valid, expires at ${new Date(verdict.expiresMs).toISOString()}`);
  await context.refreshIo.writeCredentials(credentials);
  return true;
}

async function refreshOnce(context: RefreshContext): Promise<boolean> {
  try {
    const credentials = await context.refreshIo.readKeychain();
    if (!credentials) {
      log.error("credentials", "No credentials found in macOS Keychain");
      return false;
    }
    return await exportCredentials(context, credentials);
  } catch (err) {
    log.error("credentials", "Failed to refresh credentials from Keychain", {
      error: String(err),
    });
    return false;
  }
}

/** A refresh function with its own renewal history. The history is in-process
 *  only: a restart starts over, which the dedicated startup exit code keeps
 *  `yarn dev` from doing in a loop. Concurrent calls join one refresh, so they
 *  cannot each launch a billed renewal before a failure is recorded. */
export function createCredentialsRefresher(refreshIo: CredentialsRefreshIo): () => Promise<boolean> {
  const context: RefreshContext = { refreshIo, history: NO_RENEWAL_FAILURES };
  return makeSharedRun(() => refreshOnce(context));
}
