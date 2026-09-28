// Type declarations for the JS sibling so `tsc -p test/tsconfig.json`
// can resolve `import { restartPlan } from "../scripts/dev-server.mjs"`
// without `allowJs: true`.

export interface RestartPlanInput {
  /** How long the backend child ran before exiting, in ms. */
  ranForMs: number;
  /** The previous backoff delay (0 on the first crash). */
  prevDelayMs: number;
  /** Consecutive fast crashes seen so far. */
  fastCrashes: number;
  /** The child's exit code; null (the default) when a signal ended it. */
  exitCode?: number | null;
}

export interface RestartPlanResult {
  action: "restart" | "giveup" | "needs-user";
  delayMs: number;
  fastCrashes: number;
}

/** Decide whether to respawn the crashed backend, and after how long. */
export declare function restartPlan(input: RestartPlanInput): RestartPlanResult;

/** Human-readable rendering of a child exit ("code 1" / "signal SIGKILL"). */
export declare function describeExit(code: number | null, signal: NodeJS.Signals | null): string;

/** Trailing hint naming the likely cause of a signal-only exit; "" when there is none. */
export declare function crashHint(signal: NodeJS.Signals | null): string;

/** The crash times still inside the recent window, including one at `nowMs`. */
export declare function recentCrashTimes(crashTimesMs: readonly number[], nowMs: number): number[];

/** Whether the backend has crashed too often lately to keep restarting it. */
export declare function tooManyRecentCrashes(recentCrashTimesMs: readonly number[]): boolean;
