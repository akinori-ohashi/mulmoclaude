import { execFile } from "child_process";
import { promisify } from "util";
import { setTimeout as sleep } from "timers/promises";
import { chmodSync, existsSync, readdirSync, statSync } from "fs";
import { createRequire } from "module";
import { userInfo } from "os";
import { dirname, join } from "path";
import { log } from "./logger/index.js";
import { ONE_SECOND_MS } from "../utils/time.js";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { claudeCredentialsPath } from "../utils/claudeConfigPath.js";
import { createCredentialsRefresher } from "./credentialsRefresh.js";
import { classifyCredentials, pickCredentials } from "./credentialsState.js";
import { pollUntil } from "../utils/pollUntil.js";

const execFileAsync = promisify(execFile);

const SPAWN_HELPER_EXEC_BITS = 0o111;

const CREDENTIALS_PATH = claudeCredentialsPath();
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Maximum time to wait for the renewed token to reach the Keychain. */
const PTY_TIMEOUT_MS = 30 * ONE_SECOND_MS;
/** Delay before sending input to the claude CLI. */
const PTY_INPUT_DELAY_MS = 3 * ONE_SECOND_MS;
const RENEWAL_POLL_INTERVAL_MS = ONE_SECOND_MS;

async function findKeychainPassword(lookupArgs: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", ...lookupArgs, "-w"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function currentUserName(): string | null {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}

/** Read the credentials from the macOS Keychain. Claude Code stores its own
 *  item under the OS user name; the service-only lookup still covers installs
 *  that use another account name, and the better of the two wins. */
export async function readFromKeychain(): Promise<string | null> {
  const account = currentUserName();
  const lookups = [...(account === null ? [] : [["-s", KEYCHAIN_SERVICE, "-a", account]]), ["-s", KEYCHAIN_SERVICE]];
  const candidates = await Promise.all(lookups.map(findKeychainPassword));
  return pickCredentials(candidates, Date.now());
}

async function keychainHasValidToken(): Promise<boolean> {
  const credentials = await readFromKeychain();
  return credentials !== null && classifyCredentials(credentials, Date.now()).kind === "valid";
}

function spawnClaude(pty: typeof import("node-pty")): import("node-pty").IPty {
  return pty.spawn("claude", [], { name: "xterm-color", cols: 80, rows: 30, cwd: process.cwd() });
}

/**
 * Spawn `claude` interactively via a PTY and send it a message: the API call
 * that follows makes the CLI refresh its expired OAuth token and write it back
 * to the macOS Keychain. Success is judged by the Keychain holding a valid
 * token, not by the CLI's reply, so the reply's language does not matter and
 * the CLI is stopped as soon as the token is in.
 */
async function awaitTokenRenewal(pty: typeof import("node-pty")): Promise<boolean> {
  const proc = spawnClaude(pty);
  const state = { exited: false };
  proc.onExit(() => {
    state.exited = true;
  });
  // Drain the output so a full PTY buffer cannot stall the CLI; its content is not needed.
  proc.onData(() => {});
  const promptTimer = setTimeout(() => {
    if (!state.exited) proc.write("hi\r");
  }, PTY_INPUT_DELAY_MS);
  try {
    const renewed = await pollUntil({
      check: keychainHasValidToken,
      shouldStop: () => state.exited,
      timeoutMs: PTY_TIMEOUT_MS,
      intervalMs: RENEWAL_POLL_INTERVAL_MS,
      now: () => Date.now(),
      sleep,
    });
    if (!renewed)
      log.error(
        "credentials",
        state.exited ? "claude CLI exited before the Keychain token was renewed" : `Token renewal timed out after ${PTY_TIMEOUT_MS / ONE_SECOND_MS}s`,
      );
    return renewed;
  } finally {
    clearTimeout(promptTimer);
    if (!state.exited) proc.kill();
  }
}

/** node-pty's prebuilds directory, resolved from wherever it's installed
 *  (hoisted or nested), or null when node-pty can't be found. */
export function nodePtyPrebuildsDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve("node-pty"));
    while (dir !== dirname(dir)) {
      if (existsSync(join(dir, "prebuilds"))) return join(dir, "prebuilds");
      dir = dirname(dir);
    }
  } catch {
    // node-pty not resolvable — nothing to fix
  }
  return null;
}

/** Restore +x on one prebuild's `spawn-helper`, if it's a regular file that
 *  lacks it. Errors are per-entry so one bad platform bundle can't abort the
 *  repair of the others. */
function restoreSpawnHelperExec(helper: string): void {
  try {
    if (!existsSync(helper)) return;
    const info = statSync(helper);
    if (!info.isFile()) return;
    if ((info.mode | SPAWN_HELPER_EXEC_BITS) !== info.mode) chmodSync(helper, info.mode | SPAWN_HELPER_EXEC_BITS);
  } catch {
    // best-effort — skip this entry, keep repairing the rest
  }
}

/** Runtime backstop for `posix_spawnp failed`. node-pty execs its prebuilt
 *  `spawn-helper` before the target command, but ships it mode 644 in the npm
 *  tarball; an install that skipped lifecycle scripts (`--ignore-scripts`,
 *  some `npm ci` setups) leaves it non-executable and every spawn throws. The
 *  postinstall normally restores +x — this covers installs that never ran it,
 *  so it also protects end users who never run the test suite. Best-effort:
 *  any failure is swallowed and we still attempt the spawn. */
export function ensureSpawnHelperExecutable(): void {
  const prebuilds = nodePtyPrebuildsDir();
  if (prebuilds === null) return;
  let platforms: string[];
  try {
    platforms = readdirSync(prebuilds);
  } catch {
    return;
  }
  for (const platform of platforms) restoreSpawnHelperExec(join(prebuilds, platform, "spawn-helper"));
}

async function renewTokenViaPty(): Promise<boolean> {
  // Dynamic import — node-pty is a native module that may not be present
  // on all platforms. Guard with try/catch.
  let pty: typeof import("node-pty");
  try {
    pty = await import("node-pty");
  } catch {
    log.error("credentials", "node-pty not available, cannot renew token");
    return false;
  }

  ensureSpawnHelperExecutable();
  return awaitTokenRenewal(pty);
}

export async function writeCredentialsFile(credentials: string): Promise<void> {
  // Atomic so a readers mid-refresh can't see a truncated creds
  // file; mode preserves the 0o600 we always set on this file.
  await writeFileAtomic(CREDENTIALS_PATH, `${credentials}\n`, { mode: 0o600 });
  log.info("credentials", "Fresh credentials written to ~/.claude/.credentials.json");
}

const sharedRefresh = createCredentialsRefresher({
  readKeychain: readFromKeychain,
  renewViaCli: renewTokenViaPty,
  writeCredentials: writeCredentialsFile,
  nowMs: () => Date.now(),
});

/**
 * Extract the current OAuth credentials from the macOS Keychain and write them
 * to ~/.claude/.credentials.json so that the Docker-based sandbox can read them.
 *
 * If the access token is expired, spawns `claude` interactively via a PTY to
 * force the CLI to refresh its token, then re-reads the fresh credentials.
 * Each spawn is a billed Claude session, so credentials that no renewal can fix
 * are rejected up front and repeated failures stop further attempts.
 *
 * Returns true if credentials were successfully refreshed, false otherwise.
 * Only works on macOS (darwin).
 */
export async function refreshCredentials(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  return sharedRefresh();
}
