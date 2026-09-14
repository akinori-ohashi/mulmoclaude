// The policy only protects a surface that REGISTERS it, and every other test
// in this suite builds its own `Marked`. So removing
// `marked.use(rawHtmlPolicyExtension)` from either production setup left all
// 83 of them green while the app was unprotected — a gap Codex named in
// round 6 by pointing at the exact deletion that would survive the suite.
//
// A source assertion is a blunt instrument, and it is the right one here:
// the host's `setup.ts` imports a stylesheet, so it cannot be loaded in
// Node, and the plugin's registration lives at module scope in a `.vue`
// file. What matters is that removing a registration turns something red.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

/** Every marked setup that renders markdown the app did not write. A new one
 *  added here without the policy is the failure this guards against. */
const SETUPS = ["src/utils/markdown/setup.ts", "packages/plugins/markdown-plugin/src/plugins/markdown/View.vue"];

describe("every marked setup registers the raw-HTML policy", () => {
  SETUPS.forEach((relative) => {
    it(`${relative} calls marked.use(rawHtmlPolicyExtension)`, () => {
      const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
      assert.match(source, /marked\.use\(rawHtmlPolicyExtension\)/, `${relative} renders author markdown without the class/style policy`);
      assert.match(
        source,
        /rawHtmlPolicyExtension.*from "@mulmoclaude\/markdown-utils\/markdown\/rawHtmlPolicy"/,
        `${relative} must import the policy it registers`,
      );
    });
  });

  it("names every setup that exists, so a new one cannot be forgotten silently", () => {
    // If a third marked setup appears, this count is what makes someone look.
    assert.equal(SETUPS.length, 2);
  });
});
