import { ref } from "vue";
import { MAX_SUBMIT_TEXT_CHARS, readSubmitMessage, type SubmitEventLike } from "../core/submitMessage";
import { deliveryFor, type SubmitMode } from "../core/submitMode";

export interface PendingSubmission {
  text: string;
}

export type SendText = (text?: string) => boolean | void;

export interface DirectSubmitClock {
  lastAtMs: number | null;
}

export interface SubmitReceiverDeps<TimerHandle> {
  /** The Window of the iframe currently showing the page; a message from any other source is ignored. */
  frameWindow: () => unknown;
  mode: () => SubmitMode | undefined;
  /** The key carried in this frame document's URL fragment; undefined when the page is not direct. */
  expectedKey: () => string | undefined;
  sender: () => SendText | undefined;
  nowMs: () => number;
  clock: DirectSubmitClock;
  setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer: (handle: TimerHandle | undefined) => void;
}

export const SENT_NOTICE_MS = 2_500;

// What the presented page asked to send. A page without the direct mode is only ever HELD for the
// user to confirm: it is LLM-authored, and a click inside its frame cannot be told from a scripted one.
// Kept free of lifecycle and DOM so every decision here runs under node:test.
export function createSubmitReceiver<TimerHandle>(deps: SubmitReceiverDeps<TimerHandle>) {
  const submission = ref<PendingSubmission | null>(null);
  const rejectedTooLong = ref(false);
  const sendFailed = ref(false);
  const sentNotice = ref(false);
  let noticeTimer: TimerHandle | undefined;

  // A host returns false when the terminal could not take the text; an older host returns nothing.
  function deliver(text: string): boolean {
    const sender = deps.sender();
    return sender !== undefined && sender(text) !== false;
  }

  function showSent() {
    sentNotice.value = true;
    deps.clearTimer(noticeTimer);
    noticeTimer = deps.setTimer(() => (sentNotice.value = false), SENT_NOTICE_MS);
  }

  function hold(text: string, failed: boolean) {
    rejectedTooLong.value = false;
    submission.value = { text };
    sendFailed.value = failed;
  }

  function discard() {
    submission.value = null;
    rejectedTooLong.value = false;
    sendFailed.value = false;
  }

  function receive(text: string, givenKey: string | undefined) {
    const nowMs = deps.nowMs();
    const check = { mode: deps.mode(), expectedKey: deps.expectedKey(), givenKey, lastDirectAtMs: deps.clock.lastAtMs, nowMs };
    if (deliveryFor(check) === "confirm") return hold(text, false);
    if (!deliver(text)) return hold(text, true);
    deps.clock.lastAtMs = nowMs;
    discard();
    showSent();
  }

  function onMessage(event: SubmitEventLike) {
    if (deps.sender() === undefined) return;
    const read = readSubmitMessage(event, deps.frameWindow());
    if (read.kind === "ignored") return;
    if (read.kind === "tooLong") {
      discard();
      rejectedTooLong.value = true;
      return;
    }
    receive(read.text, read.key);
  }

  function sendHeld() {
    const text = submission.value?.text;
    if (!text || text.trim() === "" || text.length > MAX_SUBMIT_TEXT_CHARS) return;
    if (!deliver(text)) {
      sendFailed.value = true;
      return;
    }
    discard();
    showSent();
  }

  function dispose() {
    deps.clearTimer(noticeTimer);
  }

  return { submission, rejectedTooLong, sendFailed, sentNotice, onMessage, sendHeld, discard, dispose };
}
