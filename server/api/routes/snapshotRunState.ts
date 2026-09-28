/** A session's run state at one instant, read from the session store. */
export interface RunSample {
  isRunning: boolean;
  runGeneration: number;
}

/** Sampled on both sides of a transcript read. The snapshot may be incomplete
 *  if a run was live at either end, or if a whole run started and finished in
 *  between, which neither `isRunning` sample would see. */
export function snapshotMayBeMidRun(beforeRead: RunSample, afterRead: RunSample): boolean {
  return beforeRead.isRunning || afterRead.isRunning || beforeRead.runGeneration !== afterRead.runGeneration;
}
