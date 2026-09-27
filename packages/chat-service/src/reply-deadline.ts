// A turn's reply limit is counted from when the relay RECEIVED the message,
// not from when the turn reached the front of its chat's queue. The bridge
// client starts its ack timer when it sends, so a limit counted from the start
// of collection let a queued or slow-to-start turn outlive the client's wait
// and have its reply dropped (#3312).

/** Milliseconds of the reply limit still left at `nowMs`; never negative. */
export function remainingReplyMs(receivedAtMs: number, replyTimeoutMs: number, nowMs: number): number {
  return Math.max(0, receivedAtMs + replyTimeoutMs - nowMs);
}
