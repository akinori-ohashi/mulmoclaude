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
  // The WHOLE repo, not a pathspec. Limiting this to `src packages` hid
  // `server/api/routes/pdf.ts`, which renders author markdown in a process
  // where the SPA's `setupMarked()` never runs (codex round 8).
  const out = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
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

/** Any RUNTIME import of marked, under any alias. Matching `marked.use(`
 *  instead missed `import { marked as md }`, `const md = marked`, a wrapper
 *  helper, or a computed `["html"]` key — all of which Codex named as
 *  mutations that would pass (round 8). Every one of them still has to
 *  import the module, so that is what this looks for. A `import type {…}`
 *  cannot render anything and is excluded by the negative lookahead. */
function importsMarkedAtRuntime(code: string): boolean {
  // Every runtime spelling, not just the one this repo happens to use today.
  // `from "marked"` alone misses `require("marked")`, `await import("marked")`
  // and a single-quoted import — codex named all three as a way to add an
  // unprotected renderer without being discovered. Prettier would rewrite the
  // quotes here, but a guard that depends on the formatter is a guard with a
  // hole in it.
  const RUNTIME_IMPORT = /from\s*["']marked["']|(?:require|import)\s*\(\s*["']marked["']\s*\)/;
  return code
    .split("\n")
    .filter((line) => RUNTIME_IMPORT.test(line))
    .some((line) => !line.trimStart().startsWith("import type"));
}
const REGISTERS_POLICY = /marked\.use\(rawHtmlPolicyExtension\)|instance\.use\(rawHtmlPolicyExtension\)/;

/** Exempt surfaces, each with the reason it does not need its own
 *  registration. Only two reasons are acceptable, and every entry below was
 *  checked against the file: it renders through the GLOBAL `marked` that
 *  `setup.ts` configures (so it inherits the policy), or it never renders
 *  author HTML at all. Anything else is an unprotected surface wearing an
 *  excuse. */
const EXEMPT: Record<string, string> = {
  // These parse with the GLOBAL `marked`, which `src/utils/markdown/setup.ts`
  // configures before the app mounts. They inherit the policy; registering it
  // again would be noise.
  "src/utils/markdown/renderMarkdown.ts": "renders through the global marked configured by setup.ts",
  "src/plugins/textResponse/View.vue": "renders through the global marked configured by setup.ts",
  "src/plugins/textResponse/Preview.vue": "renders through the global marked configured by setup.ts",
  "src/plugins/wiki/helpers.ts": "renders through the global marked configured by setup.ts",
  "packages/markdown-utils/src/image/rewriteMarkdownImageRefs.ts": "walks tokens to rewrite image refs; never renders author HTML",
  // Imports `Renderer` to BUILD an extension. It defines no `html` renderer —
  // the separate override guard below is what keeps that true.
  "src/utils/markdown/workspaceLinkify.ts": "imports Renderer to construct an extension; does not parse",
};

describe("every production marked configuration registers the raw-HTML policy", () => {
  const configuring = trackedSources().filter((file) => importsMarkedAtRuntime(readCode(file)));

  it("finds the surfaces at all — a discovery that finds nothing proves nothing", () => {
    assert.ok(configuring.length >= 3, `expected the host, plugin and server-pdf surfaces at minimum, found ${configuring.length}`);
  });

  it("every discovered configuration registers the policy or is exempt with a reason", () => {
    const unprotected = configuring.filter((file) => !REGISTERS_POLICY.test(readCode(file)) && EXEMPT[file] === undefined);
    assert.deepEqual(unprotected, [], `these render author markdown without the class/style policy: ${unprotected.join(", ")}`);
  });

  // `wikiLinkExtension` is INERT outside the window `withWikiLinks` opens, so a
  // new wiki render path that forgets it loses every link — silently, because
  // nothing throws and `[[x]]` simply renders as text.
  //
  // This replaces a guard that checked every `renderWikiLinks` caller carried
  // the app-markup proof. That guard did not fail when the proof was deleted —
  // it passed VACUOUSLY, because its subject no longer had any callers. A guard
  // whose discovery returns nothing asserts that an empty list is empty, which
  // is the exact shape round 7 of #3153 rejected. Hence the count assertion.
  it("every production file that renders wiki markdown opens the wiki-link window", () => {
    const wikiRenderers = trackedSources().filter((file) => {
      const code = readCode(file);
      return /\bmarked(\.parse)?\s*\(/.test(code) && code.includes("renderWikiPageHtml");
    });
    assert.ok(wikiRenderers.length >= 1, "discovery found no wiki render path — this guard would pass vacuously");
    // The CALL, not the mention: an `import { withWikiLinks }` line survives
    // deleting the window, so a substring check passes while every link is
    // inert. Verified by removing the window and watching this go red.
    const missing = wikiRenderers.filter((file) => !/\bwithWikiLinks\s*\(/.test(readCode(file)));
    assert.deepEqual(missing, [], `these render wiki markdown with the link extension inert: ${missing.join(", ")}`);
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
