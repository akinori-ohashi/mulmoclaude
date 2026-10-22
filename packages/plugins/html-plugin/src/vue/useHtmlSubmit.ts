import { onBeforeUnmount, onMounted, type Ref } from "vue";
import type { SubmitMode } from "../core/submitMode";
import { createSubmitReceiver, type DirectSubmitClock, type SendText } from "./submitReceiver";

export type { PendingSubmission, SendText } from "./submitReceiver";

export interface HtmlSubmitOptions {
  mode: () => SubmitMode | undefined;
  /** The key carried in this frame document's URL fragment; undefined when the page is not direct. */
  expectedKey: () => string | undefined;
  sender: () => SendText | undefined;
}

// One clock for every card in the tab: kept per card, an agent presenting several direct pages, or a
// card being remounted, would each start a fresh interval.
const directSubmitClock: DirectSubmitClock = { lastAtMs: null };

export function useHtmlSubmit(frame: Ref<HTMLIFrameElement | undefined>, options: HtmlSubmitOptions) {
  const receiver = createSubmitReceiver({
    frameWindow: () => frame.value?.contentWindow,
    mode: options.mode,
    expectedKey: options.expectedKey,
    sender: options.sender,
    nowMs: () => performance.now(),
    clock: directSubmitClock,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (handle) => clearTimeout(handle),
  });
  const onMessage = (event: MessageEvent) => receiver.onMessage(event);

  onMounted(() => window.addEventListener("message", onMessage));
  onBeforeUnmount(() => {
    window.removeEventListener("message", onMessage);
    receiver.dispose();
  });

  const { submission, rejectedTooLong, sendFailed, sentNotice, sendHeld, discard } = receiver;
  return { submission, rejectedTooLong, sendFailed, sentNotice, sendHeld, discard };
}
