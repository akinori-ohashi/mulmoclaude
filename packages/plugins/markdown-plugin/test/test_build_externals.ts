// `@mulmoclaude/markdown-utils` must stay external, root and every subpath: it
// pulls in mermaid and MathJax (its peers), and a bundled copy gives a host that
// also renders markdown a second copy of both.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExternals, importSpecifiersIn, isExternal, sourceFiles } from "../../../../scripts/lib/pluginExternals.js";

const PACKAGE_DIR = join(import.meta.dirname, "..");
const MARKDOWN_UTILS = "@mulmoclaude/markdown-utils";

function markdownUtilsSpecifiersInSource(): string[] {
  const found = sourceFiles(join(PACKAGE_DIR, "src"), [".ts", ".vue"]).flatMap((file) =>
    importSpecifiersIn(readFileSync(file, "utf8")).filter((specifier) => specifier === MARKDOWN_UTILS || specifier.startsWith(`${MARKDOWN_UTILS}/`)),
  );
  return [...new Set(found)].sort();
}

describe("build externals", () => {
  it("leaves every markdown-utils import the source makes to the consumer", async () => {
    const list = await buildExternals(PACKAGE_DIR);
    const specifiers = markdownUtilsSpecifiersInSource();
    assert.ok(
      specifiers.some((specifier) => specifier.endsWith("/mermaidRender")),
      "the scan must see the mermaid renderer, or this test checks nothing",
    );
    assert.deepEqual(
      specifiers.filter((specifier) => !isExternal(specifier, list)),
      [],
    );
  });

  it("leaves the package root to the consumer too, for an import added later", async () => {
    assert.equal(isExternal(MARKDOWN_UTILS, await buildExternals(PACKAGE_DIR)), true);
  });
});
