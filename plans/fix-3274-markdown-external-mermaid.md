# fix: markdown-plugin shares the host's mermaid (#3274, rest)

## Problem

`@mulmoclaude/markdown-plugin` bundled `@mulmoclaude/markdown-utils`, and with it
mermaid, MathJax, KaTeX and cytoscape (markdown-utils' peers). The host renders
markdown through its own markdown-utils too, so its build carried two copies of
each (`mermaid.core`, `cytoscape.esm`, … appear twice in `dist/client/assets`).

Externalising markdown-utils exposed a second defect: four relative imports in
markdown-utils have no `.js`, so those dist files fail in plain Node ESM
(`ERR_MODULE_NOT_FOUND`). Bundlers and tsx resolve them, which is why it never
surfaced; published 3.0.0 carries the same four.

## Change

- markdown-utils: add `.js` to the four imports; `test/test_esmSpecifiers.ts`
  requires every relative import in src to name a `.js` file.
- markdown-plugin: add `/^@mulmoclaude\/markdown-utils(\/|$)/` to `external`.
- shapescript-plugin test: the three-specifier scan uses `ts.preProcessFile`
  instead of a regex (same set; the regex form tripped the unsafe-regex lint).

## Release order

markdown-utils 3.0.1 first, then markdown-plugin with its markdown-utils range at
`^3.0.1`, so no consumer resolves the Node-broken 3.0.0 through the plugin.
