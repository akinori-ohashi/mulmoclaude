import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { importSpecifiersIn, isExternal, sourceFiles } from "../../scripts/lib/pluginExternals.js";

describe("isExternal", () => {
  it("matches a string entry exactly, not by prefix", () => {
    assert.equal(isExternal("three", ["three"]), true);
    assert.equal(isExternal("three-bvh-csg", ["three"]), false);
    assert.equal(isExternal("three/examples/jsm/exporters/STLExporter.js", ["three"]), false);
  });

  it("matches a RegExp entry by test", () => {
    assert.equal(isExternal("@mulmoclaude/markdown-utils/markdown/frontmatter", [/^@mulmoclaude\/markdown-utils(\/|$)/]), true);
    assert.equal(isExternal("@mulmoclaude/markdown-utils", [/^@mulmoclaude\/markdown-utils(\/|$)/]), true);
    assert.equal(isExternal("@mulmoclaude/markdown-utils-extra", [/^@mulmoclaude\/markdown-utils(\/|$)/]), false);
  });

  it("matches nothing against an empty list", () => {
    assert.equal(isExternal("three", []), false);
  });
});

describe("importSpecifiersIn", () => {
  it("finds a specifier in every import form", () => {
    assert.deepEqual(importSpecifiersIn(`import * as THREE from "three";`), ["three"]);
    assert.deepEqual(importSpecifiersIn(`export { Evaluator } from 'three-bvh-csg';`), ["three-bvh-csg"]);
    assert.deepEqual(importSpecifiersIn(`import "./side-effect";`), ["./side-effect"]);
    assert.deepEqual(importSpecifiersIn(`const m = await import("./lazy.js");`), ["./lazy.js"]);
    assert.deepEqual(importSpecifiersIn(`await import ( 'three' )`), ["three"]);
    assert.deepEqual(importSpecifiersIn(`import type { T } from "./types";`), ["./types"]);
  });

  it("finds a specifier split across lines", () => {
    assert.deepEqual(importSpecifiersIn(`import {\n  Mesh,\n} from\n  "three";`), ["three"]);
  });

  it("ignores names that appear anywhere but an import", () => {
    assert.deepEqual(importSpecifiersIn(`const lib = "three";`), []);
    assert.deepEqual(importSpecifiersIn(`// load three/examples lazily`), []);
    assert.deepEqual(importSpecifiersIn(`reimport("three")`), []);
  });

  it("reads the script block of a Vue single-file component", () => {
    const sfc = `<template><div>import "nope"</div></template>\n<script setup lang="ts">\nimport { ref } from "vue";\n</script>`;
    assert.ok(importSpecifiersIn(sfc).includes("vue"));
  });
});

describe("sourceFiles", () => {
  it("walks subdirectories, keeps the asked extensions and drops .d.ts", () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-externals-"));
    mkdirSync(join(root, "nested"));
    ["a.ts", "b.vue", "c.d.ts", "d.js", "nested/e.ts"].forEach((name) => writeFileSync(join(root, name), ""));
    const found = sourceFiles(root, [".ts", ".vue"])
      .map((file) => relative(root, file))
      .sort();
    assert.deepEqual(found, ["a.ts", "b.vue", join("nested", "e.ts")]);
  });
});
