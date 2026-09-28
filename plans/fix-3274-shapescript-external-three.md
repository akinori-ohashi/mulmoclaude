# fix: shapescript-plugin shares the host's three (#3274, partial)

## Problem

`@mulmoclaude/shapescript-plugin` bundled three into its dist. mulmoserver imports
`astToThreeJS` from `.` AND uses its own three (scene, OrbitControls, exporters), so
its build carries two copies and warns `Multiple instances of Three.js being imported`.
The bundling rationale in `vite.config.ts` ("the runtime loader has no node_modules")
stopped applying when `@mulmoclaude/core` became external — no loader can load this
package, and every consumer (mulmoclaude, mulmoterminal, mulmoserver) installs it from npm.

## Change

- `vite.config.ts`: add the bare `"three"` to `external`. Only `three` — the
  `three/examples/jsm/*` modules and `three-bvh-csg` / `three-mesh-bvh` stay bundled and
  import `three` from the consumer. Externalising them splits three in Node:
  `three-bvh-csg` has no `exports`, so Node ESM loads its UMD build, which `require`s
  `three.cjs` beside our `three.module.js`.

## Verification

- Differential run of the old and new dist over the samples, the upstream examples
  and a seeded set of generated CSG scripts, in ESM and CJS: scene JSON, GLB, STL and
  USDZ (USD prim ids renumbered — three's global id counters differ) all identical.
- `./render` produces the same thumbnail PNG in ESM and CJS.
- mulmoserver (clean clone, new dist swapped in): one three in the ShapeViewer chunk.
- mulmoclaude and mulmoterminal: build passes, still one three; mulmoterminal's
  shapescript specs pass with the new dist.

## Out of scope

- The rest of #3274 (two-track loader/npm build, markdown-plugin's mermaid) and #3275.
