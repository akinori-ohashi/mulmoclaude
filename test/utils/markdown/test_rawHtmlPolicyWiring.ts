// The policy only protects a surface that REGISTERS it, and every other test
// in this suite builds its own `Marked`. So removing
// `marked.use(rawHtmlPolicyExtension)` from a production setup left all of
// them green while the app rendered author markdown unprotected (codex
// round 6).
//
// The first version of this guard enumerated the two setups and asserted the
// LIST still had two entries — which proves only that an array I control has
// two entries. A third markdown surface would have appeared with everything
// green (codex round 7). So it DISCOVERS surfaces instead, and the rule is
// stated as what is permitted: a production file that configures its own
// marked must register the policy, or be listed as exempt with a reason.
//
// Source assertions are a blunt instrument and the right one here: the host's
// `setup.ts` imports a stylesheet so it cannot be loaded in Node, and the
// plugin registers at module scope inside a `.vue`. What matters is that
// losing protection turns something red.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

/** Tracked production sources only. `git ls-files` is what keeps generated
 *  copies out — `packages/mulmoclaude/src/` is an untracked build artifact of
 *  the launcher's `files` list and is byte-identical to `src/`, so scanning
 *  the filesystem would report it as a second, unprotected surface. */
function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "src", "packages"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .filter((file) => /\.(ts|vue)$/.test(file))
    .filter((file) => !file.includes("/test/") && !file.startsWith("test/"));
}

/** Source with comments removed. Both `wikiEmbeds.ts` and `mathExtension.ts`
 *  DESCRIBE `marked.use(...)` in prose, and matching that reported them as
 *  unprotected surfaces. Exempting them would have been the wrong fix: it
 *  would also have masked a real registration appearing in those same files
 *  later. */
function readCode(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Files that configure a marked instance of their own and therefore need the
 *  policy. A file that merely calls the already-configured global does not. */
const CONFIGURES_MARKED = /new Marked\(|marked\.use\(/;
const REGISTERS_POLICY = /marked\.use\(rawHtmlPolicyExtension\)|instance\.use\(rawHtmlPolicyExtension\)/;

/** Exempt surfaces, each with the reason it cannot host author markdown.
 *  Empty on purpose: nothing currently qualifies. An entry here is a claim
 *  someone has to defend. */
const EXEMPT: Record<string, string> = {};

describe("every production marked configuration registers the raw-HTML policy", () => {
  const configuring = trackedSources().filter((file) => CONFIGURES_MARKED.test(readCode(file)));

  it("finds the configurations at all — a discovery that finds nothing proves nothing", () => {
    assert.ok(configuring.length >= 2, `expected to discover the host and plugin setups, found ${configuring.length}`);
  });

  it("every discovered configuration registers the policy or is exempt with a reason", () => {
    const unprotected = configuring.filter((file) => !REGISTERS_POLICY.test(readCode(file)) && EXEMPT[file] === undefined);
    assert.deepEqual(unprotected, [], `these render author markdown without the class/style policy: ${unprotected.join(", ")}`);
  });

  it("no other production file overrides renderer.html, which would bypass the policy", () => {
    // Later `.use()` calls wrap earlier ones, so a second `html` renderer
    // registered after this one would take the author's raw HTML first and
    // could return it untouched.
    const owner = "packages/markdown-utils/src/markdown/rawHtmlPolicy.ts";
    const overriding = trackedSources()
      .filter((file) => file !== owner)
      .filter((file) => /\bhtml\(token|\bhtml\(\{/.test(readCode(file)));
    assert.deepEqual(overriding, [], `these define a renderer.html that could bypass the policy: ${overriding.join(", ")}`);
  });
});
