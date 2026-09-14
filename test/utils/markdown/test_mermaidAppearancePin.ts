// mermaid 12 moved its defaults to the bundled ELK layout and the
// redux-color / neo look, which re-lays out and recolours every diagram that
// already exists. `mermaidRender.ts` pins the pre-12 appearance so the upgrade
// is not also a silent redesign.
//
// Rendering both versions side by side in a browser showed the pin is what
// makes the difference: with it, all 8 diagram types matched mermaid 11
// exactly; without it, flowchart / class / state / er / sequence all changed
// (flowchart went from 13 to 34 fill colours). A browser is too heavy for this
// suite, so the durable half of that check is kept here — the source must
// still carry the three keys. Dropping one is a visual regression nothing else
// would catch.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = join(process.cwd(), "packages", "markdown-utils", "src", "markdown", "mermaidRender.ts");

function initializeCall(): string {
  const src = readFileSync(SOURCE, "utf8");
  const match = /mermaid\.initialize\(\{[^}]*\}\)/.exec(src);
  assert.ok(match, "mermaidRender.ts no longer calls mermaid.initialize({ ... })");
  return match[0];
}

describe("mermaid appearance pin", () => {
  it("pins the layout engine to dagre, not mermaid 12's bundled ELK", () => {
    assert.match(initializeCall(), /layout:\s*"dagre"/);
  });

  it("pins the look to classic, not mermaid 12's neo", () => {
    assert.match(initializeCall(), /look:\s*"classic"/);
  });

  it("pins the theme to default, not mermaid 12's redux-color", () => {
    assert.match(initializeCall(), /theme:\s*"default"/);
  });

  it("still drives rendering itself and keeps label sanitising on", () => {
    const call = initializeCall();
    assert.match(call, /startOnLoad:\s*false/);
    assert.match(call, /securityLevel:\s*"strict"/);
  });
});
