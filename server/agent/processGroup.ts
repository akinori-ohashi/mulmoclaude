import type { constants } from "node:os";

export type SignalName = keyof typeof constants.signals;
export type SignalSender = (pid: number, signal: SignalName) => void;

/** `gone` (ESRCH) is the only result that proves the group has exited;
 *  `failed` (EPERM, an unusable pid, …) leaves its state unknown. */
export type GroupSignalResult = "sent" | "gone" | "failed";

const hasErrorCode = (err: unknown, code: string): boolean => typeof err === "object" && err !== null && "code" in err && err.code === code;

const sendWithProcessKill: SignalSender = (pid, signal) => {
  process.kill(pid, signal);
};

/** Signals every process in the group led by `leaderPid` (a child spawned
 *  with `detached: true`).
 *
 *  The pid guard is a safety rule, not tidiness: `kill(-0)` signals OUR
 *  OWN group and `kill(-1)` every process we may signal, so an unset or
 *  non-positive pid must never reach `process.kill`. */
export function signalProcessGroup(leaderPid: number | undefined, signal: SignalName, send: SignalSender = sendWithProcessKill): GroupSignalResult {
  if (leaderPid === undefined || !Number.isSafeInteger(leaderPid) || leaderPid <= 1) return "failed";
  try {
    send(-leaderPid, signal);
    return "sent";
  } catch (err) {
    return hasErrorCode(err, "ESRCH") ? "gone" : "failed";
  }
}
