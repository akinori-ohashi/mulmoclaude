import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { readSubmitMessage } from "../core/submitMessage";

export interface PendingSubmission {
  text: string;
}

// Holds what the presented page asked to send, for the user to confirm. Nothing here sends:
// the page is LLM-authored and a click inside its frame cannot be told from a scripted one.
export function useHtmlSubmit(frame: Ref<HTMLIFrameElement | undefined>, isEnabled: () => boolean) {
  const submission = ref<PendingSubmission | null>(null);
  const rejectedTooLong = ref(false);

  function onMessage(event: MessageEvent) {
    if (!isEnabled()) return;
    const read = readSubmitMessage(event, frame.value?.contentWindow);
    if (read.kind === "ignored") return;
    rejectedTooLong.value = read.kind === "tooLong";
    submission.value = read.kind === "text" ? { text: read.text } : null;
  }

  // Also the iframe's load handler: a decision made before any (re)load, by the host or by the page
  // itself, no longer describes what is on screen.
  function discard() {
    submission.value = null;
    rejectedTooLong.value = false;
  }

  onMounted(() => window.addEventListener("message", onMessage));
  onBeforeUnmount(() => window.removeEventListener("message", onMessage));

  return { submission, rejectedTooLong, discard };
}
