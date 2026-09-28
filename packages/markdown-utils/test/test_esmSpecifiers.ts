// Every relative import in src must name its `.js` file. tsc emits the
// specifier as written, and Node's ESM resolver does not guess extensions, so
// an extensionless one makes that dist file fail to load in plain Node
// (ERR_MODULE_NOT_FOUND) while bundlers and tsx — including this suite's
// runner — resolve it and hide the break.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import typescript from "typescript";

const SRC = join(import.meta.dirname, "..", "src");
const RELATIVE = /^\.{1,2}\//;

// TypeScript's own scanner, so every form counts — static, re-export,
// side-effect, dynamic, `import type` — and strings or comments do not.
function relativeSpecifiersIn(text: string): string[] {
  return typescript
    .preProcessFile(text, true, true)
    .importedFiles.map((file) => file.fileName)
    .filter((specifier) => RELATIVE.test(specifier));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

describe("relative imports in src", () => {
  it("all name a .js file, so the emitted ESM loads in plain Node", () => {
    const files = sourceFiles(SRC);
    const specifiers = files.flatMap((file) => relativeSpecifiersIn(readFileSync(file, "utf8")).map((specifier) => ({ file, specifier })));
    assert.ok(specifiers.length > 0, "the scan must find relative imports, or this test checks nothing");
    const missing = specifiers.filter(({ specifier }) => !specifier.endsWith(".js")).map(({ file, specifier }) => `${relative(SRC, file)}: ${specifier}`);
    assert.deepEqual(missing, []);
  });
});

describe("relativeSpecifiersIn", () => {
  it("finds a relative specifier in every import form", () => {
    assert.deepEqual(relativeSpecifiersIn(`import { a } from "./a.js";`), ["./a.js"]);
    assert.deepEqual(relativeSpecifiersIn(`export { b } from '../b';`), ["../b"]);
    assert.deepEqual(relativeSpecifiersIn(`import "./side-effect";`), ["./side-effect"]);
    assert.deepEqual(relativeSpecifiersIn(`const m = await import("./lazy.js");`), ["./lazy.js"]);
    assert.deepEqual(relativeSpecifiersIn(`import type { T } from "./types";`), ["./types"]);
  });

  it("finds a specifier split across lines", () => {
    assert.deepEqual(relativeSpecifiersIn(`import {\n  a,\n} from\n  "./a";`), ["./a"]);
  });

  it("ignores package specifiers and non-import strings", () => {
    assert.deepEqual(relativeSpecifiersIn(`import { marked } from "marked";`), []);
    assert.deepEqual(relativeSpecifiersIn(`const p = "./not-an-import";`), []);
    assert.deepEqual(relativeSpecifiersIn(`// see ./frontmatter`), []);
    assert.deepEqual(relativeSpecifiersIn(`reimport("./x")`), []);
  });
});
