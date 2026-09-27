// Start a bridge turn even when the session is still busy with an earlier run.
//
// A turn cut off at its reply limit leaves its agent running, so the next
// turn's `startChat()` used to get 409 and the message was dropped with
// "please wait" (#3320). Instead, wait for that run to finish — within the
// message's own remaining time — and start then.

import { EVENT_TYPES } from "@mulmobridge/protocol";
import type { OnSessionEventFn, StartChatFn, StartChatParams, StartChatResult } from "./types.js";

export type IdleStartResult = StartChatResult | { kind: "expired" };

export interface IdleStartDeps {
  startChat: StartChatFn;
  onSessionEvent: OnSessionEventFn;
  /** Milliseconds this message may still wait; 0 once its limit has passed. */
  remainingMs: () => number;
}

// `startChat()` answers 409 before it saves or broadcasts anything, so trying again is safe.
const isBusy = (result: StartChatResult): boolean => result.kind === "error" && result.status === 409;

interface FinishWait {
  /** True when the session reported it finished, false when the time ran out first. */
  finished: Promise<boolean>;
  cancel: () => void;
}

function waitForSessionFinished(onSessionEvent: OnSessionEventFn, sessionId: string, timeoutMs: number): FinishWait {
  const handles: { timer?: ReturnType<typeof setTimeout>; unsubscribe?: () => void } = {};
  const finished = new Promise<boolean>((resolve) => {
    const settle = (value: boolean): void => {
      clearTimeout(handles.timer);
      handles.unsubscribe?.();
      resolve(value);
    };
    handles.timer = setTimeout(() => settle(false), timeoutMs);
    handles.unsubscribe = onSessionEvent(sessionId, (event) => {
      if (event.type === EVENT_TYPES.sessionFinished) settle(true);
    });
  });
  return {
    finished,
    cancel: () => {
      clearTimeout(handles.timer);
      handles.unsubscribe?.();
    },
  };
}

async function retryWhenFinished(deps: IdleStartDeps, params: StartChatParams): Promise<IdleStartResult> {
  const remainingMs = deps.remainingMs();
  if (remainingMs === 0) return { kind: "expired" };
  // Subscribe BEFORE trying again: a run that ends between the 409 and the
  // subscription would otherwise never be seen, and this would wait out the limit.
  const wait = waitForSessionFinished(deps.onSessionEvent, params.chatSessionId, remainingMs);
  const retried = await deps.startChat(params).catch((err: unknown) => {
    wait.cancel();
    throw err;
  });
  if (!isBusy(retried)) {
    wait.cancel();
    return retried;
  }
  return (await wait.finished) ? retryWhenFinished(deps, params) : { kind: "expired" };
}

export async function startChatWhenIdle(deps: IdleStartDeps, params: StartChatParams): Promise<IdleStartResult> {
  const first = await deps.startChat(params);
  return isBusy(first) ? retryWhenFinished(deps, params) : first;
}
