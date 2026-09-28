import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { createVuePluginConfig } from "../../../scripts/lib/pluginViteConfig";

// Three entries: the server-facing `.`/core (tool definition + execute, which
// only type-imports gui-chat-protocol) and the browser `./vue` (View/Preview +
// the Three.js renderer). `vue` and `gui-chat-protocol/vue` are externalised so
// the plugin and host share ONE instance (the injected PLUGIN_RUNTIME_KEY
// Symbol must match). `three` itself is external for the same reason: a host
// that draws the model with its own three (mulmoserver's scene and exporters)
// must share ONE copy. Only the bare `three` — the `three/examples/jsm/*`
// modules and the CSG helpers stay bundled and import it from here. Leaving
// them external splits three in Node: `three-bvh-csg` has no `exports`, so
// Node loads its UMD build, which `require`s three.cjs next to our three.module.js.
// This package is never loaded by the runtime loader (its cache has no
// node_modules) — `@mulmoclaude/core` is external too, which it could not resolve.
export default createVuePluginConfig({
  plugins: [vue(), tailwindcss()],
  entry: {
    index: resolve(__dirname, "src/index.ts"),
    core: resolve(__dirname, "src/core/index.ts"),
    vue: resolve(__dirname, "src/vue/index.ts"),
    render: resolve(__dirname, "src/render/index.ts"),
  },
  name: "MulmoClaudePluginShapeScript",
  // `puppeteer` and the node built-ins belong to the SERVER-only `./render` entry:
  // external so a browser driver is never bundled, and so the host's own hoisted
  // copy is the one that runs.
  external: [
    /^@mulmoclaude\/core/,
    "vue",
    "gui-chat-protocol",
    "gui-chat-protocol/vue",
    "puppeteer",
    "three",
    "node:fs/promises",
    "node:module",
    "node:path",
    "node:url",
  ],
});
