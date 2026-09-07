#!/usr/bin/env node
// Does every plugin that RENDERS a core-owned Tailwind class also SCAN the file
// that declares it?
//
// Tailwind v4 finds classes by scanning the project its CSS entry belongs to.
// The host's vite root is the repository, so `packages/core/src` is scanned and
// core's classes land in the app's CSS. A plugin's vite root is its own package,
// so the same classes are invisible to its build and drop out of the package's
// `dist/style.css` — silently, because the host renders them anyway. Anyone
// loading the plugin AS A PACKAGE (a runtime plugin, another host) gets unstyled
// output: 43 of the 76 enum-palette classes were missing this way (#2989).
//
// The fix is an `@source` in the plugin's CSS naming the core file. This gate is
// what keeps the next palette from repeating it — core is where shared colour
// tables belong, and nothing about adding one tells you a plugin's CSS needs a
// line too.
//
// Usage: node scripts/packages/check-plugin-tailwind-source.mjs
// Exit 0 = every such plugin scans what it renders. Exit 1 = at least one does not.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const CORE_SRC = path.join(REPO_ROOT, "packages", "core", "src");
const PLUGINS_DIR = path.join(REPO_ROOT, "packages", "plugins");

// A Tailwind utility that names a palette colour (`bg-lime-50`,
// `hover:bg-teal-100`). Only the coloured ones matter: they are the classes a
// shared palette spells out, and a bare utility (`flex`, `grow`) is emitted by
// every package's own sources anyway.
//
// Split into "find a token" + "is this token one" rather than one pattern that
// also matches the variant prefix: a `[a-z-]+:` run in front of the alternation
// gives the engine somewhere to backtrack, which is a ReDoS surface a build gate
// has no business carrying (eslint security/detect-unsafe-regex).
const TOKEN_RE = /[A-Za-z0-9:_-]+/g;
const COLOR_CLASS_RE = /^(?:bg|text|border|ring|fill|from|via|to|outline|divide|accent|caret|decoration|shadow)-[a-z]+-\d{2,3}$/;
// One line, single spaces: every source here is prettier-formatted, and a
// whitespace run before an optional `declare` is the same backtracking shape.
const EXPORT_LINE_RE = /^export (?:declare )?(?:const|function|class|interface|type|enum) ([A-Za-z_$][\w$]*)/;
// `export { palette, ENUM_ALERT as ALERT }` — a file can declare its palette
// locally and export it in a list, which no per-line declaration pattern sees.
// Whole-source rather than per-line because prettier wraps a long list.
const EXPORT_LIST_RE = /export\s*\{([^}]*)\}/g;
const NAME_RE = /^[A-Za-z_$][\w$]*$/;
// A default export is the one shape this rule cannot follow: the importer picks
// the local name, so there is nothing to match against. Refused rather than
// ignored — see `undetectableCoreFiles`. Two spellings reach it (`export default
// X` and `export { x as default }`), so the check asks ONE question of the parse
// — "is `default` among the names this module hands out?" — rather than
// enumerating the ways to write it.
const DEFAULT_EXPORT_RE = /^export default\b/m;
const DEFAULT_NAME = "default";
const SOURCE_RE = /@source\s+"([^"]+)"/g;
// A CSS comment. Tailwind's parser ignores what is inside one, so a gate that
// does not would read a commented-out `@source` as live — passing while the
// build omits the palette again, which is the exact failure it exists to catch.
const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const SOURCE_EXTS = [".ts", ".tsx", ".vue"];

/** The utility a class token names, with any variant prefix (`hover:`) removed. */
const withoutVariants = (token) => token.slice(token.lastIndexOf(":") + 1);

/** Every coloured Tailwind class named in `source`. */
export function colorClassesIn(source) {
  const tokens = source.match(TOKEN_RE) ?? [];
  return new Set(tokens.filter((token) => COLOR_CLASS_RE.test(withoutVariants(token))));
}

/** The name an export-list entry makes available: the alias of `a as b`, the
 *  symbol of `type Foo`, the entry itself otherwise. */
const exportedAs = (entry) => entry.trim().split(/\s+/).pop() ?? "";

/** Every symbol `source` exports by name, from declarations and from lists.
 *
 *  A braced RE-export (`export { helper } from "./b"`) counts too. It names a
 *  symbol this file hands out, and over-reporting only ever asks a plugin for an
 *  `@source` it may not need — the other direction is the bug this gate exists
 *  for. */
export function exportedNamesIn(source) {
  return allExportedNames(source).filter((name) => name !== DEFAULT_NAME);
}

/** Every name the module hands out, `default` included — the parse both public
 *  questions are asked of. */
function allExportedNames(source) {
  const declared = source
    .split("\n")
    .map((line) => EXPORT_LINE_RE.exec(line)?.[1])
    .filter((name) => name !== undefined);
  const listed = [...source.matchAll(EXPORT_LIST_RE)]
    .flatMap((match) => (match[1] ?? "").split(","))
    .map(exportedAs)
    .filter((name) => NAME_RE.test(name));
  return [...new Set([...declared, ...listed])];
}

/** `css` with every comment blanked out. Spaces rather than removal, so the rest
 *  of the file keeps its offsets. */
export function withoutComments(css) {
  return css.replace(COMMENT_RE, (match) => " ".repeat(match.length));
}

/** Every path a CSS file hands to a LIVE `@source`, in the order they appear. */
export function sourceTargetsIn(css) {
  return [...withoutComments(css).matchAll(SOURCE_RE)].map((match) => match[1]);
}

/** Does a resolved `@source` target cover `file`? A target is either the file
 *  itself or a directory above it — Tailwind walks a directory target. */
export function sourceCovers(target, file) {
  return target === file || file.startsWith(target + path.sep);
}

/** Whether `source` hands anything out under a name the importer chooses —
 *  `export default X` or `export { x as default }`. */
export function hasDefaultExport(source) {
  return DEFAULT_EXPORT_RE.test(source) || allExportedNames(source).includes(DEFAULT_NAME);
}

/** Class-carrying core files whose use this rule cannot detect at all: a default
 *  import arrives under whatever local name the plugin chooses, so no name match
 *  can see it. Reported as a failure so the blind spot is loud — a shared palette
 *  is expected to use named exports. */
export function undetectableCoreFiles(coreFiles) {
  return coreFiles.filter((core) => core.classes.size > 0 && core.hasDefaultExport);
}

/** Which core files a plugin renders classes from but never scans.
 *
 *  Pure: `coreFiles` are `{ file, classes, exports }` and `plugins` are
 *  `{ name, cssPath, targets, usedExports }`, both already read off disk. */
export function findGaps(coreFiles, plugins) {
  const gaps = [];
  for (const plugin of plugins) {
    for (const core of coreFiles) {
      const used = core.exports.filter((name) => plugin.usedExports.includes(name));
      if (core.classes.size === 0 || used.length === 0) continue;
      if (plugin.targets.some((target) => sourceCovers(target, core.file))) continue;
      gaps.push({ plugin: plugin.name, cssPath: plugin.cssPath, coreFile: core.file, symbols: used, classes: core.classes.size });
    }
  }
  return gaps;
}

/** Every file under `dir` whose extension one of these builds would scan. */
function sourceFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return SOURCE_EXTS.includes(path.extname(entry.name)) ? [full] : [];
  });
}

/** The core files that declare coloured classes, with the symbols they export. */
function coreFilesWithClasses() {
  return sourceFilesUnder(CORE_SRC)
    .map((file) => {
      const source = readFileSync(file, "utf-8");
      return { file, classes: colorClassesIn(source), exports: exportedNamesIn(source), hasDefaultExport: hasDefaultExport(source) };
    })
    .filter((entry) => entry.classes.size > 0);
}

/** Which of `names` a plugin's own sources mention. Word-bounded, so a symbol
 *  that merely appears inside a longer identifier does not count. */
function usedExportsOf(pluginSrc, names) {
  const text = sourceFilesUnder(pluginSrc)
    .map((file) => readFileSync(file, "utf-8"))
    .join("\n");
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
}

/** Every plugin package that ships a Tailwind entry, with what it scans and uses. */
function pluginsWithCss(coreExports) {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, cssPath: path.join(PLUGINS_DIR, entry.name, "src", "style.css") }))
    .filter((plugin) => existsSync(plugin.cssPath))
    .map((plugin) => {
      const cssDir = path.dirname(plugin.cssPath);
      const targets = sourceTargetsIn(readFileSync(plugin.cssPath, "utf-8")).map((target) => path.resolve(cssDir, target));
      return { ...plugin, targets, usedExports: usedExportsOf(cssDir, coreExports) };
    });
}

/** Path as it reads in a message: relative to the repository. */
const rel = (file) => path.relative(REPO_ROOT, file);

/** Report core files this rule cannot follow at all. */
function reportUndetectable(files) {
  console.error(`[plugin-css] FAIL — ${files.length} core file(s) declare Tailwind classes behind a default export:`);
  for (const core of files) console.error(`  ${rel(core.file)}`);
  console.error("");
  console.error("  A default import arrives under whatever name the plugin picks, so this");
  console.error("  gate cannot tell who renders those classes. Export the palette by name.");
}

/** Report plugins rendering classes their own build never scans. */
function reportGaps(gaps) {
  console.error(`[plugin-css] FAIL — ${gaps.length} plugin(s) render core classes their build never scans:`);
  for (const gap of gaps) {
    console.error(`  ${gap.plugin} uses ${gap.symbols.join(", ")} from ${rel(gap.coreFile)} (${gap.classes} classes)`);
    console.error(`    add to ${rel(gap.cssPath)}:  @source "${path.relative(path.dirname(gap.cssPath), gap.coreFile)}";`);
  }
  console.error("");
  console.error("  Without it those classes are missing from the package's dist/style.css.");
  console.error("  The host app renders them anyway, so the gap only shows up for whoever");
  console.error("  loads the plugin as a package — which is why it needs a gate, not an eye.");
}

function main() {
  const coreFiles = coreFilesWithClasses();
  const plugins = pluginsWithCss(coreFiles.flatMap((core) => core.exports));
  const undetectable = undetectableCoreFiles(coreFiles);
  const gaps = findGaps(coreFiles, plugins);
  if (undetectable.length > 0) {
    reportUndetectable(undetectable);
    return 1;
  }
  if (gaps.length > 0) {
    reportGaps(gaps);
    return 1;
  }
  console.log(`[plugin-css] OK — ${plugins.length} plugin CSS entries, ${coreFiles.length} core file(s) declaring classes, no gaps.`);
  return 0;
}

// Only run the CLI when invoked directly, so tests can import the helpers.
if (process.argv[1] && statSync(process.argv[1]).isFile() && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
