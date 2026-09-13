// jsdom coverage for the delegated click listener behind the code-copy
// buttons: what reaches the clipboard, what the button shows afterwards,
// and that installing twice into one document adds one listener.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM, type DOMWindow } from "jsdom";
import { Marked } from "marked";
import { installCodeCopyHandler, codeTextOf, _resetCodeCopyHandlerForTests } from "@mulmoclaude/markdown-utils/markdown/codeCopyClipboard";
import {
  codeCopyExtension,
  CODE_COPY_ATTR,
  CODE_COPY_BLOCK_ATTR,
  CODE_COPY_IDLE_LABEL_ATTR,
  CODE_COPY_COPIED_LABEL_ATTR,
  CODE_BLOCK_STYLE_FENCED,
  CODE_BLOCK_STYLE_INDENTED,
} from "@mulmoclaude/markdown-utils/markdown/codeCopyExtension";

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
    `<div class="relative" ${CODE_COPY_BLOCK_ATTR}="${CODE_BLOCK_STYLE_FENCED}">`,
    `<button type="button" ${CODE_COPY_ATTR} ${CODE_COPY_IDLE_LABEL_ATTR}="Copy code" ${CODE_COPY_COPIED_LABEL_ATTR}="Copied" class="text-gray-600" aria-label="Copy code" title="Copy code"><svg><rect></rect></svg></button>`,
    '<pre><code class="hljs language-ts"><span class="hljs-keyword">const</span> a = 1;</code></pre>',
    "</div>",
  ].join("");
  _resetCodeCopyHandlerForTests(document);
  const button = document.querySelector<HTMLElement>(`[${CODE_COPY_ATTR}]`);
  assert.ok(button);
  return { document, window, button, writes, fail };
}

interface ScheduledRevert {
  revert: () => void;
  handle: number;
}

/** Replaces the window's timer pair with recorders, so the 2s feedback
 *  window costs no wall-clock and the test can inspect what was
 *  scheduled and what was cancelled. */
function installFakeTimers(view: DOMWindow, scheduled: ScheduledRevert[], cancelled: Set<number>): void {
  let nextHandle = 1;
  const fakeSetTimeout = (revert: () => void): number => {
    const handle = nextHandle;
    nextHandle += 1;
    scheduled.push({ revert, handle });
    return handle;
  };
  const fakeClearTimeout = (handle: number): void => {
    cancelled.add(handle);
  };
  const timers: { setTimeout: unknown; clearTimeout: unknown } = view;
  timers.setTimeout = fakeSetTimeout;
  timers.clearTimeout = fakeClearTimeout;
}

let env: Harness;
beforeEach(() => {
  env = harness();
});

describe("codeTextOf", () => {
  it("returns the code's text without highlight markup", () => {
    assert.equal(codeTextOf(env.button), "const a = 1;");
  });

  it("drops the renderer's trailing newline on an INDENTED block", () => {
    const block = env.document.querySelector(`[${CODE_COPY_BLOCK_ATTR}]`);
    const code = env.document.querySelector("code");
    assert.ok(block);
    assert.ok(code);
    block.setAttribute(CODE_COPY_BLOCK_ATTR, CODE_BLOCK_STYLE_INDENTED);
    code.textContent = "indented();\n";
    assert.equal(codeTextOf(env.button), "indented();");
  });

  it("keeps the same newline on a FENCED block — there it is a blank line the author wrote", () => {
    // marked strips a fence's own terminator, so a surviving `\n` is
    // content. The two shapes are indistinguishable from the text alone,
    // which is why the style travels in the wrapper attribute.
    const code = env.document.querySelector("code");
    assert.ok(code);
    code.textContent = "a();\n";
    assert.equal(codeTextOf(env.button), "a();\n");
  });

  it("returns null for a button with no code block around it", () => {
    const orphan = env.document.createElement("button");
    assert.equal(codeTextOf(orphan), null);
  });
});

describe("codeTextOf over real marked output", () => {
  // The unit tests above set `textContent` by hand, which can only pin
  // what I believe marked produces. This drives the REAL renderer for
  // every fence shape whose trailing whitespace differs, and asserts the
  // clipboard gets back exactly what the author typed. It is the pair
  // that regressed once already: strip on a fence and the author's blank
  // line is gone; do not strip on an indented block and a line nobody
  // wrote is pasted.
  const marked = new Marked();
  marked.use(codeCopyExtension);

  const cases: { name: string; source: string; expected: string }[] = [
    { name: "fenced, no trailing blank line", source: "```js\na();\n```", expected: "a();" },
    { name: "fenced, one trailing blank line", source: "```js\na();\n\n```", expected: "a();\n" },
    { name: "fenced, two trailing blank lines", source: "```js\na();\n\n\n```", expected: "a();\n\n" },
    { name: "fenced, no language tag", source: "```\na();\n```", expected: "a();" },
    { name: "indented, 4 spaces", source: "para\n\n    a();\n", expected: "a();" },
    { name: "fenced, blank line in the MIDDLE", source: "```js\na();\n\nb();\n```", expected: "a();\n\nb();" },
  ];

  cases.forEach(({ name, source, expected }) => {
    it(`copies exactly what the author wrote — ${name}`, () => {
      env.document.body.innerHTML = marked.parse(source) as string;
      const button = env.document.querySelector(`[${CODE_COPY_ATTR}]`);
      assert.ok(button);
      assert.equal(codeTextOf(button), expected);
    });
  });
});

describe("installCodeCopyHandler", () => {
  it("copies the block's source on click", async () => {
    installCodeCopyHandler(env.document);
    env.button.click();
    await settle();
    assert.deepEqual(env.writes, ["const a = 1;"]);
  });

  it("copies when the click lands on the icon inside the button", async () => {
    installCodeCopyHandler(env.document);
    env.document.querySelector("rect")?.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true }));
    await settle();
    assert.deepEqual(env.writes, ["const a = 1;"]);
  });

  it("shows the copied state after a successful copy", async () => {
    installCodeCopyHandler(env.document);
    env.button.click();
    await settle();
    assert.equal(env.button.getAttribute("aria-label"), "Copied");
    assert.equal(env.button.getAttribute("title"), "Copied");
    assert.ok(env.button.classList.contains("text-green-600"));
  });

  it("stays idle when the clipboard write is refused", async () => {
    installCodeCopyHandler(env.document);
    env.fail.value = true;
    env.button.click();
    await settle();
    assert.equal(env.button.getAttribute("aria-label"), "Copy code");
    assert.ok(!env.button.classList.contains("text-green-600"));
  });

  it("captions from the BUTTON, not from whoever installed the listener", async () => {
    // The plugin's buttons must not be captioned by the host's provider
    // just because the host installed the one surviving listener.
    installCodeCopyHandler(env.document);
    env.button.setAttribute(CODE_COPY_COPIED_LABEL_ATTR, "コピーしました");
    env.button.setAttribute(CODE_COPY_IDLE_LABEL_ATTR, "コードをコピー");
    env.button.click();
    await settle();
    assert.equal(env.button.getAttribute("aria-label"), "コピーしました");
  });

  it("installs once per document, so a second bundle's call adds no listener", async () => {
    installCodeCopyHandler(env.document);
    installCodeCopyHandler(env.document);
    env.button.click();
    await settle();
    assert.deepEqual(env.writes, ["const a = 1;"]);
  });

  it("serves a button injected after install — the point of delegating", async () => {
    installCodeCopyHandler(env.document);
    const later = env.document.createElement("div");
    later.innerHTML = [`<div ${CODE_COPY_BLOCK_ATTR}>`, `<button type="button" ${CODE_COPY_ATTR}></button>`, "<pre><code>later();</code></pre>", "</div>"].join(
      "",
    );
    env.document.body.appendChild(later);
    later.querySelector<HTMLElement>(`[${CODE_COPY_ATTR}]`)?.click();
    await settle();
    assert.deepEqual(env.writes, ["later();"]);
  });

  it("a second click restarts the confirmation instead of letting the first timer end it", async () => {
    // The first click's revert timer must be cancelled: left running, it
    // fires on the OLD schedule and clears the second click's feedback
    // early. Uses fake timers so the 2s window is not real wall-clock.
    installCodeCopyHandler(env.document);
    const view = env.window;
    const scheduled: ScheduledRevert[] = [];
    const cancelled = new Set<number>();
    installFakeTimers(view, scheduled, cancelled);

    env.button.click();
    await settle();
    env.button.click();
    await settle();

    assert.equal(scheduled.length, 2, "each click schedules its own revert");
    const [stale] = scheduled;
    assert.ok(stale);
    assert.ok(cancelled.has(stale.handle), "the first click's revert was cancelled");
    // Belt and braces: even if the cancelled timer still fires (already
    // dispatched when the second click landed), it must not clear the
    // live confirmation.
    stale.revert();
    assert.equal(env.button.getAttribute("aria-label"), "Copied");
  });

  it("restores the button's own idle label when reverting", async () => {
    installCodeCopyHandler(env.document);
    const scheduled: ScheduledRevert[] = [];
    installFakeTimers(env.window, scheduled, new Set<number>());

    env.button.click();
    await settle();
    assert.equal(env.button.getAttribute("aria-label"), "Copied");

    const [revert] = scheduled;
    assert.ok(revert);
    revert.revert();
    assert.equal(env.button.getAttribute("aria-label"), "Copy code");
    assert.equal(env.button.getAttribute("title"), "Copy code");
  });

  it("ignores a click outside any copy button", async () => {
    installCodeCopyHandler(env.document);
    env.document.querySelector("pre")?.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true }));
    await settle();
    assert.deepEqual(env.writes, []);
  });
});
