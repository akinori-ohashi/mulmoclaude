// Click behaviour for the copy buttons `codeCopyExtension` emits.
//
// ONE delegated listener for the whole document, not a listener per
// viewer: the buttons live inside `v-html`, so Vue cannot bind `@click`
// to them, and they are destroyed and recreated on every streamed chunk.
// Delegation is indifferent to both — the listener is attached to a node
// that outlives every re-render, and a button that appears mid-stream
// works without anyone re-running an attach pass.

import { CODE_COPY_ATTR, CODE_COPY_BLOCK_ATTR, CODE_COPY_ICON, CODE_COPIED_ICON, type CodeCopyLabels } from "./codeCopyExtension.js";

/** How long the button stays in its "copied" state before reverting. */
const FEEDBACK_DURATION_MS = 2000;
/** Applied on success and removed on revert — the whole visual delta. */
const COPIED_TINT_CLASS = "text-green-600";
/** Guards against a second listener when two bundles install the handler
 *  into one document (host + a plugin package). The flag lives on the
 *  DOCUMENT rather than in module state precisely because there can be
 *  two module instances — the host's and a plugin bundle's — and only
 *  the document is shared between them. */
interface InstallTarget extends Document {
  __mulmoclaudeCodeCopyInstalled?: boolean;
}

// `nodeType`, not `instanceof Element`: this package is browser-SAFE, not
// browser-ONLY, and the Node + jsdom harness installs `window`/`document`
// as globals without the DOM constructors — where a bare `Element` is a
// ReferenceError. Same reason `sanitizeMarkdownHtml` in core discriminates
// this way. nodeType 1 is the DOM standard's own element discriminant.
const ELEMENT_NODE = 1;
const isElement = (value: unknown): value is Element => typeof value === "object" && value !== null && "nodeType" in value && value.nodeType === ELEMENT_NODE;
// An element that can carry `classList` / `innerHTML` and be measured —
// everything the feedback swap touches. `Element` alone lacks `style`, so
// the button is narrowed once, here.
const isHtmlElement = (value: unknown): value is HTMLElement => isElement(value) && "classList" in value && "innerHTML" in value;

/** Reads the raw source a block should copy: `textContent` of the
 *  `<code>`, so highlight.js's `<span>` markup never reaches the
 *  clipboard. Exported for the tests. */
export function codeTextOf(button: Element): string | null {
  const block = button.closest(`[${CODE_COPY_BLOCK_ATTR}]`);
  const code = block?.querySelector("pre > code");
  return code?.textContent ?? null;
}

function showCopied(button: HTMLElement, labels: CodeCopyLabels): void {
  button.innerHTML = CODE_COPIED_ICON;
  button.classList.add(COPIED_TINT_CLASS);
  button.setAttribute("aria-label", labels.copied);
  button.setAttribute("title", labels.copied);
  // Re-reading the labels on revert rather than closing over today's
  // copy keeps the idle title correct if the user switched language
  // while the confirmation was on screen.
  button.ownerDocument.defaultView?.setTimeout(() => {
    button.innerHTML = CODE_COPY_ICON;
    button.classList.remove(COPIED_TINT_CLASS);
    const idle = labels.copy;
    button.setAttribute("aria-label", idle);
    button.setAttribute("title", idle);
  }, FEEDBACK_DURATION_MS);
}

async function handleClick(event: Event, getLabels: () => CodeCopyLabels): Promise<void> {
  const { target } = event;
  if (!isElement(target)) return;
  const button = target.closest(`[${CODE_COPY_ATTR}]`);
  if (!isHtmlElement(button)) return;
  const text = codeTextOf(button);
  if (text === null) return;
  const clipboard = button.ownerDocument.defaultView?.navigator?.clipboard;
  if (clipboard === undefined) return;
  try {
    await clipboard.writeText(text);
  } catch {
    // A denied clipboard permission is the user's answer, not an app
    // error: leave the button in its idle state so the icon never claims
    // a copy that did not happen. Nothing to log — the page is not the
    // place to report a permission the user controls.
    return;
  }
  showCopied(button, getLabels());
}

/**
 * Attach the delegated listener. Idempotent — a second call on the same
 * document is a no-op, so the host and a plugin bundle can both ask.
 *
 * `getLabels` is called per click rather than captured, so the
 * confirmation text follows the current locale.
 */
export function installCodeCopyHandler(doc: Document, getLabels: () => CodeCopyLabels): void {
  const target: InstallTarget = doc;
  if (target.__mulmoclaudeCodeCopyInstalled === true) return;
  target.__mulmoclaudeCodeCopyInstalled = true;
  doc.addEventListener("click", (event) => void handleClick(event, getLabels));
}

/** Test seam — lets an isolated test install into a fresh document twice. */
export function _resetCodeCopyHandlerForTests(doc: Document): void {
  const target: InstallTarget = doc;
  target.__mulmoclaudeCodeCopyInstalled = false;
}
