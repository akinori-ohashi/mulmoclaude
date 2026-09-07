#!/usr/bin/env node
// Do the relative links in `docs/` still point at files that exist?
//
// They did not. `docs/sandbox-credentials.md` pointed at
// `server/workspace/helps/sandbox.md` months after the help assets moved to
// `packages/core/assets/helps/`, and `docs/plugin-runtime.md` pointed at
// `config/plugins.registry.ts` after that manifest was deleted outright
// (df126abe4). Neither is the kind of thing a reviewer notices: the link reads
// fine, the prose around it is still true, and only a reader who CLICKS finds
// out. An outside contributor reported the first one (#2967, via PR #2965) —
// which is to say it took someone from outside the project to notice.
//
// Usage: node scripts/docs/check-doc-links.mjs
// Exit 0 = every relative link resolves. Exit 1 = at least one does not.
//
// What is NOT checked, and why: anchors (`#section`) and external URLs. An
// anchor needs heading-slug rules that differ per renderer, and a URL needs the
// network — both would make this gate answer "maybe", and a gate that is
// sometimes wrong is one people learn to skip.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");

// The TARGET half of a markdown link or image — `](target` — and nothing else.
//
// Matching the text half too (`\[[^\]]*\]\(…`) is what every naive version of
// this does, and it is why eslint's `sonarjs/super-linear-regex` fires: a
// variable-length run before the literal gives the engine somewhere to
// backtrack, and a docs gate has no business being a ReDoS surface. The text
// is not needed here — only where the link POINTS matters — so the cheapest
// correct pattern is also the safest one. The target ends at the first space or
// `)`, which drops a `"title"` suffix for free.
const LINK_RE = /\]\(([^)\s]+)/g;
// A fenced code block, and a `code span`. Both hold markdown that is being
// SHOWN, not followed — `docs/image-path-routing.md` is a whole document about
// how paths are rewritten, so its tables are full of `![](../../etc/passwd)`
// and `![](./foo.png)`. Verifying those would make the gate demand that the
// repository contain the very files the prose invents to explain a rule.
const FENCE_RE = /^```[\s\S]*?^```/gm;
const CODE_SPAN_RE = /`[^`\n]*`/g;

/** Every `.md` file under `dir`, recursively. */
export function markdownFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFilesUnder(full));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
}

/** True when a link target names something on disk that this gate can verify.
 *  Anything else — a URL, a bare anchor, a `data:` blob, an API route, a
 *  placeholder in prose (`foo.png`, `<short-id>.png`) — is not a repository
 *  path and would make the gate cry wolf. */
export function isCheckableTarget(target) {
  if (/^(https?:|mailto:|data:|#|\/api\/)/.test(target)) return false;
  if (target.includes("<") || target.includes("…")) return false;
  // A repository path is written relative to the doc (`./x`, `../x`) — a bare
  // `foo.png` in these files is always an example of what a USER would type.
  return target.startsWith("./") || target.startsWith("../");
}

/** `text` with every fenced block and code span blanked out, so a link inside
 *  one is never read as a link to follow. Replaced with spaces rather than
 *  removed, to keep the rest of the document's offsets intact. */
export function withoutCode(text) {
  const blank = (match) => " ".repeat(match.length);
  return text.replace(FENCE_RE, blank).replace(CODE_SPAN_RE, blank);
}

/** Every checkable link target in `text`, ignoring anything inside code. */
export function linkTargetsIn(text) {
  return [...withoutCode(text).matchAll(LINK_RE)]
    .map((match) => match[1])
    .filter((target) => target !== undefined)
    .map((target) => target.split("#")[0])
    .filter((target) => target !== undefined && target.length > 0)
    .filter(isCheckableTarget);
}

function brokenLinksIn(file) {
  const fromDir = path.dirname(file);
  return linkTargetsIn(readFileSync(file, "utf-8"))
    .filter((target) => !existsSync(path.resolve(fromDir, target)))
    .map((target) => ({ file: path.relative(REPO_ROOT, file), target }));
}

function main() {
  const files = markdownFilesUnder(DOCS_DIR);
  const broken = files.flatMap(brokenLinksIn);
  if (broken.length === 0) {
    console.log(`[docs:links] OK — every relative link in ${files.length} docs resolves.`);
    return 0;
  }
  console.error(`[docs:links] FAIL — ${broken.length} relative link(s) point at nothing:`);
  for (const { file, target } of broken) console.error(`  ${file} → ${target}`);
  console.error("");
  console.error("  A moved file leaves the link reading fine and pointing nowhere.");
  console.error("  Update the link, or delete it if what it referenced is gone.");
  return 1;
}

// Only run the CLI when invoked directly, so tests can import the helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main();
}
