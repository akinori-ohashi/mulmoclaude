// Click behaviour for the copy buttons `codeCopyExtension` emits.
//
// ONE delegated listener for the whole document, not a listener per
// viewer: the buttons live inside `v-html`, so Vue cannot bind `@click`
// to them, and they are destroyed and recreated on every streamed chunk.
// Delegation is indifferent to both — the listener is attached to a node
// that outlives every re-render, and a button that appears mid-stream
// works without anyone re-running an attach pass.
//
// It takes no labels. Only the FIRST install on a document keeps its
// listener (host and plugin bundles both call this), so any provider
// captured here would caption the other bundle's buttons too. The
// renderer writes both label states into each button instead, which also
// keeps them following the locale for free: a language switch re-renders
// the markdown, and the new markup carries the new strings.

import {
  CODE_COPY_ATTR,
  CODE_COPY_BLOCK_ATTR,
  CODE_COPY_ICON,
  CODE_COPIED_ICON,
  CODE_COPY_IDLE_LABEL_ATTR,
  CODE_COPY_COPIED_LABEL_ATTR,
  CODE_BLOCK_STYLE_INDENTED,
} from "./codeCopyExtension.js";

/** How long the button stays in its "copied" state before reverting. */
const FEEDBACK_DURATION_MS = 2000;
/** Applied on success and removed on revert — the whole visual delta. */
const COPIED_TINT_CLASS = "text-green-600";

/** Guards against a second listener when two bundles install the handler
 *  into one document (host + a plugin package). The flag lives on the
 *  DOCUMENT rather than in module state precisely because there can be
 *  two module instances, and only the document is shared between them. */
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
// An element that can carry `classList` / `innerHTML` — everything the
// feedback swap touches. `Element` alone lacks them.
const isHtmlElement = (value: unknown): value is HTMLElement => isElement(value) && "classList" in value && "innerHTML" in value;

/**
 * Reads the raw source a block should copy: `textContent` of the
 * `<code>`, so highlight.js's `<span>` markup never reaches the
 * clipboard. Exported for the tests.
 */
export function codeTextOf(button: Element): string | null {
  const block = button.closest(`[${CODE_COPY_BLOCK_ATTR}]`);
  const code = block?.querySelector("pre > code");
  const text = code?.textContent;
  if (text === undefined || text === null) return null;
  // ONLY for an indented block. Marked leaves a trailing newline there
  // that the author did not write, and strips it from a fenced block —
  // so on a fence the very same `\n` IS content, the blank line before
  // the closing ```. The two are identical once rendered, which is why
  // the style has to travel in the markup rather than be guessed here.
  const indented = block?.getAttribute(CODE_COPY_BLOCK_ATTR) === CODE_BLOCK_STYLE_INDENTED;
  return indented ? stripTrailingNewline(text) : text;
}

function stripTrailingNewline(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** The accessible name and the tooltip are the same string; setting them
 *  in one place is what stops the two drifting apart. */
function setLabel(button: HTMLElement, label: string | null): void {
  if (label === null) return;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
}

// One pending revert per button. Without this, clicking again while the
// confirmation is up leaves the FIRST timer running: it fires on the old
// schedule and clears the second click's feedback early. Keyed weakly so
// a button removed by the next streamed re-render is collectable.
const pendingReverts = new WeakMap<HTMLElement, number>();

function showCopied(button: HTMLElement): void {
  const view = button.ownerDocument.defaultView;
  // No window means a detached document nobody is looking at. Bail
  // before mutating, rather than leaving a confirmation that can never
  // revert because there is no timer to schedule.
  if (view === null || view === undefined) return;
  setLabel(button, button.getAttribute(CODE_COPY_COPIED_LABEL_ATTR));
  button.innerHTML = CODE_COPIED_ICON;
  button.classList.add(COPIED_TINT_CLASS);
  const pending = pendingReverts.get(button);
  if (pending !== undefined) view.clearTimeout(pending);
  const handle: number = view.setTimeout(() => {
    // Identity check, not just `clearTimeout`: a stale callback that
    // still runs — a timer already dispatched when the second click
    // cancelled it — must not clear the live confirmation.
    if (pendingReverts.get(button) !== handle) return;
    pendingReverts.delete(button);
    button.innerHTML = CODE_COPY_ICON;
    button.classList.remove(COPIED_TINT_CLASS);
    setLabel(button, button.getAttribute(CODE_COPY_IDLE_LABEL_ATTR));
  }, FEEDBACK_DURATION_MS);
  pendingReverts.set(button, handle);
}

async function handleClick(event: Event): Promise<void> {
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
  showCopied(button);
}

/**
 * Attach the delegated listener. Idempotent — a second call on the same
 * document is a no-op, so the host and a plugin bundle can both ask.
 */
export function installCodeCopyHandler(doc: Document): void {
  const target: InstallTarget = doc;
  if (target.__mulmoclaudeCodeCopyInstalled === true) return;
  target.__mulmoclaudeCodeCopyInstalled = true;
  doc.addEventListener("click", (event) => void handleClick(event));
}

/** Test seam — lets an isolated test install into a fresh document twice. */
export function _resetCodeCopyHandlerForTests(doc: Document): void {
  const target: InstallTarget = doc;
  target.__mulmoclaudeCodeCopyInstalled = false;
}
