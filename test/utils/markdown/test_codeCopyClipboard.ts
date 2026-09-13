// jsdom coverage for the delegated click listener behind the code-copy
// buttons: what reaches the clipboard, what the button shows afterwards,
// and that installing twice into one document adds one listener.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM, type DOMWindow } from "jsdom";
import { installCodeCopyHandler, codeTextOf, _resetCodeCopyHandlerForTests } from "@mulmoclaude/markdown-utils/markdown/codeCopyClipboard";
import { CODE_COPY_ATTR, CODE_COPY_BLOCK_ATTR, type CodeCopyLabels } from "@mulmoclaude/markdown-utils/markdown/codeCopyExtension";

const LABELS: CodeCopyLabels = { copy: "Copy code", copied: "Copied" };
/** The listener awaits `clipboard.writeText`, so the assertions have to
 *  come after at least one microtask turn. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  document: Document;
  /** jsdom's own window type — the lib.dom `Window` lacks the
   *  constructors (`MouseEvent`) these tests dispatch through. */
  window: DOMWindow;
  button: HTMLElement;
  writes: string[];
  /** Set to reject the next write, standing in for a denied permission. */
  fail: { value: boolean };
}

/** A block shaped like the extension's output: highlight.js `<span>`s
 *  inside the `<code>` so the "copies textContent, not markup" claim is
 *  actually exercised. */
function harness(): Harness {
  const dom = new JSDOM("<!doctype html><body></body>");
  const { document } = dom.window;
  const { window } = dom;
  const writes: string[] = [];
  const fail = { value: false };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string): Promise<void> => {
        if (fail.value) throw new Error("denied");
        writes.push(text);
      },
    },
  });
  document.body.innerHTML = [
    `<div class="relative" ${CODE_COPY_BLOCK_ATTR}>`,
    `<button type="button" ${CODE_COPY_ATTR} class="text-gray-600" aria-label="Copy code" title="Copy code"><svg><rect></rect></svg></button>`,
    '<pre><code class="hljs language-ts"><span class="hljs-keyword">const</span> a = 1;</code></pre>',
    "</div>",
  ].join("");
  _resetCodeCopyHandlerForTests(document);
  const button = document.querySelector<HTMLElement>(`[${CODE_COPY_ATTR}]`);
  assert.ok(button);
  return { document, window, button, writes, fail };
}

let env: Harness;
beforeEach(() => {
  env = harness();
});

describe("codeTextOf", () => {
  it("returns the code's text without highlight markup", () => {
    assert.equal(codeTextOf(env.button), "const a = 1;");
  });

  it("returns null for a button with no code block around it", () => {
    const orphan = env.document.createElement("button");
    assert.equal(codeTextOf(orphan), null);
  });
});

describe("installCodeCopyHandler", () => {
  it("copies the block's source on click", async () => {
    installCodeCopyHandler(env.document, () => LABELS);
    env.button.click();
    await settle();
    assert.deepEqual(env.writes, ["const a = 1;"]);
  });

  it("copies when the click lands on the icon inside the button", async () => {
    installCodeCopyHandler(env.document, () => LABELS);
    env.document.querySelector("rect")?.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true }));
    await settle();
    assert.deepEqual(env.writes, ["const a = 1;"]);
  });

  it("shows the copied state after a successful copy", async () => {
    installCodeCopyHandler(env.document, () => LABELS);
    env.button.click();
    await settle();
    assert.equal(env.button.getAttribute("aria-label"), "Copied");
    assert.equal(env.button.getAttribute("title"), "Copied");
    assert.ok(env.button.classList.contains("text-green-600"));
  });

  it("stays idle when the clipboard write is refused", async () => {
    installCodeCopyHandler(env.document, () => LABELS);
    env.fail.value = true;
    env.button.click();
    await settle();
    assert.equal(env.button.getAttribute("aria-label"), "Copy code");
    assert.ok(!env.button.classList.contains("text-green-600"));
  });

  it("reads the labels per click, so a locale switch is picked up", async () => {
    let labels: CodeCopyLabels = LABELS;
    installCodeCopyHandler(env.document, () => labels);
    labels = { copy: "コードをコピー", copied: "コピーしました" };
    env.button.click();
    await settle();
    assert.equal(env.button.getAttribute("aria-label"), "コピーしました");
  });

  it("installs once per document, so a second bundle's call adds no listener", async () => {
    installCodeCopyHandler(env.document, () => LABELS);
    installCodeCopyHandler(env.document, () => LABELS);
    env.button.click();
    await settle();
    assert.deepEqual(env.writes, ["const a = 1;"]);
  });

  it("serves a button injected after install — the point of delegating", async () => {
    installCodeCopyHandler(env.document, () => LABELS);
    const later = env.document.createElement("div");
    later.innerHTML = [`<div ${CODE_COPY_BLOCK_ATTR}>`, `<button type="button" ${CODE_COPY_ATTR}></button>`, "<pre><code>later();</code></pre>", "</div>"].join(
      "",
    );
    env.document.body.appendChild(later);
    later.querySelector<HTMLElement>(`[${CODE_COPY_ATTR}]`)?.click();
    await settle();
    assert.deepEqual(env.writes, ["later();"]);
  });

  it("ignores a click outside any copy button", async () => {
    installCodeCopyHandler(env.document, () => LABELS);
    env.document.querySelector("pre")?.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true }));
    await settle();
    assert.deepEqual(env.writes, []);
  });
});
