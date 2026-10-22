import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { MAX_SUBMIT_TEXT_CHARS, readSubmitMessage } from "../core/submitMessage";
import { deliveryFor, type SubmitMode } from "../core/submitMode";

export interface PendingSubmission {
  text: string;
}

export type SendText = (text?: string) => boolean | void;

export interface HtmlSubmitOptions {
  mode: () => SubmitMode | undefined;
  /** The key carried in this frame document's URL fragment; undefined when the page is not direct. */
  expectedKey: () => string | undefined;
  sender: () => SendText | undefined;
}

const SENT_NOTICE_MS = 2_500;

// One clock for every card in the tab: kept per card, an agent presenting several direct pages, or a
// card being remounted, would each start a fresh interval.
const directSubmitClock: { lastAtMs: number | null } = { lastAtMs: null };

// What the presented page asked to send. A page without the direct mode is only ever HELD for the
// user to confirm: it is LLM-authored, and a click inside its frame cannot be told from a scripted one.
export function useHtmlSubmit(frame: Ref<HTMLIFrameElement | undefined>, options: HtmlSubmitOptions) {
  const submission = ref<PendingSubmission | null>(null);
  const rejectedTooLong = ref(false);
  const sendFailed = ref(false);
  const sentNotice = ref(false);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  // A host returns false when the terminal could not take the text; an older host returns nothing.
  function deliver(text: string): boolean {
    const sender = options.sender();
    return sender !== undefined && sender(text) !== false;
  }

  function showSent() {
    sentNotice.value = true;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (sentNotice.value = false), SENT_NOTICE_MS);
  }

  function hold(text: string, failed: boolean) {
    rejectedTooLong.value = false;
    submission.value = { text };
    sendFailed.value = failed;
  }

  function receive(text: string, givenKey: string | undefined) {
    const nowMs = performance.now();
    const check = { mode: options.mode(), expectedKey: options.expectedKey(), givenKey, lastDirectAtMs: directSubmitClock.lastAtMs, nowMs };
    if (deliveryFor(check) === "confirm") return hold(text, false);
    if (!deliver(text)) return hold(text, true);
    directSubmitClock.lastAtMs = nowMs;
    discard();
    showSent();
  }

  function onMessage(event: MessageEvent) {
    if (options.sender() === undefined) return;
    const read = readSubmitMessage(event, frame.value?.contentWindow);
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

  // Also the iframe's load handler: a decision made before any (re)load, by the host or by the page
  // itself, no longer describes what is on screen.
  function discard() {
    submission.value = null;
    rejectedTooLong.value = false;
    sendFailed.value = false;
  }

  onMounted(() => window.addEventListener("message", onMessage));
  onBeforeUnmount(() => {
    window.removeEventListener("message", onMessage);
    clearTimeout(noticeTimer);
  });

  return { submission, rejectedTooLong, sendFailed, sentNotice, discard, sendHeld };
}
