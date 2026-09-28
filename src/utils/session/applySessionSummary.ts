import type { ActiveSession, SessionSummary } from "../../types/session";

export type LiveSessionState = Pick<ActiveSession, "isRunning" | "statusMessage" | "hasUnread">;

/** Bring one in-memory session in line with the server's summary. Returns true
 *  when this flipped it from running to stopped — the sign that its
 *  `session_finished` event was missed, and with it the post-run refresh. */
export function applySessionSummary(live: LiveSessionState, summary: SessionSummary, isCurrentSession: boolean): boolean {
  const wasRunning = live.isRunning;
  live.isRunning = summary.isRunning ?? false;
  live.statusMessage = summary.statusMessage ?? "";
  const unread = summary.hasUnread ?? false;
  // The session on screen is being read right now, so a server "unread" for it
  // must not light the badge back up.
  if (!(unread && isCurrentSession)) live.hasUnread = unread;
  return wasRunning && !live.isRunning;
}
