// The gate exists because a plugin's Tailwind build scans only its own package,
// so 43 of the 76 classes the shared enum palette spells out in core were absent
// from `collection-plugin/dist/style.css` while the host app rendered them fine
// (#2989). What these tests pin is not "the plugins are currently wired" — the
// gate itself checks that — but the four judgements that would silently disarm
// it: which strings are palette classes, what a file exports, what a plugin
// scans, and when a scan actually covers a file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  colorClassesIn,
  exportedNamesIn,
  findGaps,
  hasDefaultExport,
  sourceCovers,
  sourceTargetsIn,
  undetectableCoreFiles,
  withoutComments,
} from "../../../scripts/packages/check-plugin-tailwind-source.mjs";

describe("colorClassesIn", () => {
  it("takes the coloured utilities a palette spells out, variants included", () => {
    const found = colorClassesIn('card: "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100"');
    assert.deepEqual([...found].sort(), ["bg-indigo-50", "border-indigo-200", "hover:bg-indigo-100", "text-indigo-600"]);
  });

  it("ignores utilities that carry no colour, which every package emits for itself", () => {
    assert.equal(colorClassesIn('class="flex grow rounded-full p-2 text-sm"').size, 0);
  });

  it("does not read a bare word as a class — that is what makes a directory scan noisy", () => {
    assert.equal(colorClassesIn("const contents = ring(shrink);").size, 0);
  });
});

describe("exportedNamesIn", () => {
  it("names every exported declaration kind", () => {
    const source = [
      "export interface EnumColorClasses { card: string }",
      "export const ENUM_ALERT: EnumColorClasses = { card: 'x' };",
      "export function resolveEnumColor() {}",
      "export type Palette = readonly string[];",
    ].join("\n");
    assert.deepEqual(exportedNamesIn(source), ["EnumColorClasses", "ENUM_ALERT", "resolveEnumColor", "Palette"]);
  });

  it("ignores a star re-export and a local declaration — neither names a symbol this file hands out", () => {
    assert.deepEqual(exportedNamesIn('export * from "./core/enumColors";\nconst PALETTE = [];'), []);
  });

  // A palette declared locally and exported in a list is invisible to a
  // per-declaration pattern, so the gate would not know the plugin uses it
  // (Codex review iter-2).
  it("reads a named export list, including an alias and a type entry", () => {
    assert.deepEqual(exportedNamesIn("const palette = 1;\nexport { palette };"), ["palette"]);
    assert.deepEqual(exportedNamesIn("export {\n  ENUM_ALERT as ALERT,\n  type EnumColorClasses,\n};"), ["ALERT", "EnumColorClasses"]);
  });

  it("names a symbol once when it is both declared and listed", () => {
    assert.deepEqual(exportedNamesIn("export const A = 1;\nexport { A };"), ["A"]);
  });
});

describe("sourceTargetsIn", () => {
  it("reads every @source target in order", () => {
    const css = '@import "tailwindcss";\n@source "../a.ts";\n@source "../../b";\n';
    assert.deepEqual(sourceTargetsIn(css), ["../a.ts", "../../b"]);
  });

  it("finds nothing in a plain entry — the state that produced the bug", () => {
    assert.deepEqual(sourceTargetsIn('@import "tailwindcss";\n'), []);
  });

  // Tailwind's parser ignores comments, so a gate that reads one as live would
  // pass on a CSS whose build emits nothing (Codex review iter-1).
  it("does not read a commented-out directive as live", () => {
    assert.deepEqual(sourceTargetsIn('@import "tailwindcss";\n/* @source "../a.ts"; */\n'), []);
  });

  it("still reads a live directive that a comment merely sits beside", () => {
    assert.deepEqual(sourceTargetsIn('/* why this is here */\n@source "../a.ts";\n'), ["../a.ts"]);
  });
});

describe("withoutComments", () => {
  it("keeps the length, so nothing after a comment shifts", () => {
    const css = "a/* xx */b";
    assert.equal(withoutComments(css), "a        b");
  });
});

describe("sourceCovers", () => {
  const file = path.join("/repo", "packages", "core", "src", "collection", "enumColors.ts");

  it("covers the file named directly", () => {
    assert.equal(sourceCovers(file, file), true);
  });

  it("covers a file under a directory target", () => {
    assert.equal(sourceCovers(path.join("/repo", "packages", "core", "src"), file), true);
  });

  it("does not let a sibling with a shared prefix pass as a parent", () => {
    // `/repo/packages/core/src-old` is not above `/repo/packages/core/src/…`,
    // and a plain startsWith would say it is.
    assert.equal(sourceCovers(path.join("/repo", "packages", "core", "src-old"), file), false);
  });
});

// A default import arrives under a name the plugin picks, so no name match can
// see the use. The gate refuses the shape rather than passing blind on it
// (Codex review iter-3). `packages/core/src` has no default export today.
describe("undetectableCoreFiles", () => {
  const withDefault = (classes: string[]) => ({ file: "/repo/core/palette.ts", classes: new Set(classes), exports: [], hasDefaultExport: true });

  it("refuses a class-carrying file behind a default export", () => {
    assert.equal(undetectableCoreFiles([withDefault(["bg-lime-50"])]).length, 1);
  });

  it("says nothing about a default export that declares no classes", () => {
    assert.deepEqual(undetectableCoreFiles([withDefault([])]), []);
  });

  it("reads the shape off the source, in either spelling", () => {
    assert.equal(hasDefaultExport("export default PALETTE;"), true);
    // `export { x as default }` leaves under a name the importer picks too, so
    // both spellings answer the same question of the parse (Codex review iter-4).
    assert.equal(hasDefaultExport("const p = 1;\nexport { p as default };"), true);
    assert.equal(hasDefaultExport("export const PALETTE = 1;"), false);
    // Prose about the shape is not the shape.
    assert.equal(hasDefaultExport("// never export default from here\n"), false);
  });

  it("does not offer `default` as a name a plugin could be matched against", () => {
    assert.deepEqual(exportedNamesIn("export { p as default, ENUM_ALERT };"), ["ENUM_ALERT"]);
  });
});

describe("findGaps", () => {
  const coreFile = path.join("/repo", "packages", "core", "src", "enumColors.ts");
  const palette = { file: coreFile, classes: new Set(["bg-lime-50"]), exports: ["resolveEnumColor"], hasDefaultExport: false };
  const plugin = (targets: string[], usedExports: string[]) => ({
    name: "collection-plugin",
    cssPath: "/repo/packages/plugins/collection-plugin/src/style.css",
    targets,
    usedExports,
  });

  it("flags a plugin that renders the palette and scans nothing", () => {
    const gaps = findGaps([palette], [plugin([], ["resolveEnumColor"])]);
    assert.equal(gaps.length, 1);
    assert.deepEqual(gaps[0]?.symbols, ["resolveEnumColor"]);
  });

  it("passes when the file is named directly, and when a directory above it is", () => {
    assert.deepEqual(findGaps([palette], [plugin([coreFile], ["resolveEnumColor"])]), []);
    assert.deepEqual(findGaps([palette], [plugin([path.dirname(coreFile)], ["resolveEnumColor"])]), []);
  });

  it("ignores a plugin that imports nothing from the file", () => {
    assert.deepEqual(findGaps([palette], [plugin([], ["fieldVisible"])]), []);
  });

  it("ignores a core file that declares no classes — most of core", () => {
    const plain = { file: coreFile, classes: new Set<string>(), exports: ["resolveEnumColor"], hasDefaultExport: false };
    assert.deepEqual(findGaps([plain], [plugin([], ["resolveEnumColor"])]), []);
  });
});
