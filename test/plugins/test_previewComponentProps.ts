// Every plugin preview must declare the prop the host actually passes.
//
// `SessionSidebar.vue` renders previews through a DYNAMIC component:
//
//   <component :is="getPlugin(result.toolName)?.previewComponent" :result="result" />
//
// TypeScript cannot check the props of a `<component :is>`, so a preview can
// declare something else entirely and every gate stays green. The accounting
// preview did exactly that from its first commit and rendered a generic string
// for a year (#2716): it asked for `data` / `jsonData`, which nothing has ever
// passed.
//
// A compiled Vue component carries its declared props at runtime, and the
// published `dist` is plain JS, so this census needs no SFC loader.
//
// NOT covered: the host-local previews under `src/plugins/*` that import a
// `.vue` file directly (canvas, editImages, manageRoles, generateImage,
// manageSkills, presentCollection). `tsx --test` cannot load an SFC, so holding
// those needs a Vue-capable runner. This covers the packaged plugins, which is
// where the bug was and where new plugins are added.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Packaged plugins whose built `vue` entry exports a preview component. */
const PACKAGED_PLUGINS = ["accounting", "chart", "collection", "form", "html", "markdown", "mulmoscript", "shapescript", "spotify"] as const;

// Empty, and asserted so it stays that way. Holding a plugin out needs a
// tracking issue and a line here saying which one.
const KNOWN_UNFIXED: readonly string[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Vue normalises `defineProps<{ result: T }>()` to `{ result: {} }` on the
 *  compiled component, so the declared NAMES survive into the bundle even
 *  though the types do not. Names are all this census needs. */
const declaredPropNames = (component: unknown): string[] | null => {
  if (!isRecord(component)) return null;
  const { props } = component;
  if (Array.isArray(props)) return props.filter((name): name is string => typeof name === "string");
  if (isRecord(props)) return Object.keys(props);
  return null;
};

/** The component the HOST actually renders. `src/tools/runtimeLoader.ts` reads
 *  `plugin.previewComponent` off the built `vue` entry — a named `*Preview`
 *  export is a convenience and need not be the same object. Checking only the
 *  named export would have passed spotify, which exports no `Preview` at all
 *  (#3226), so both are gathered and both must declare the prop. */
const registeredPreviewOf = (moduleNamespace: Record<string, unknown>): [string, unknown][] => {
  const { plugin } = moduleNamespace;
  if (!isRecord(plugin)) return [];
  const preview = plugin.previewComponent;
  return preview === undefined ? [] : [["plugin.previewComponent", preview]];
};

const previewExportsOf = (moduleNamespace: Record<string, unknown>): [string, unknown][] => [
  ...Object.entries(moduleNamespace).filter(([name]) => /preview$/i.test(name)),
  ...registeredPreviewOf(moduleNamespace),
];

describe("every packaged plugin preview declares the prop the sidebar passes", () => {
  it("the held-out list stays short and named", () => {
    // A ratchet with no assertion is a list that only ever grows.
    assert.deepEqual([...KNOWN_UNFIXED], [], "add a tracking issue before holding a plugin out");
  });

  PACKAGED_PLUGINS.forEach((plugin) => {
    it(`${plugin}`, async () => {
      const entry = path.join(repoRoot, "packages/plugins", `${plugin}-plugin`, "dist/vue.js");
      assert.ok(existsSync(entry), `${entry} is missing — run \`yarn build:packages\` before this suite`);

      // A file URL, not a path: `import()` takes a specifier, and on Windows an
      // absolute path is not one — the loader reads `D:\…` as an unknown `d:`
      // scheme and throws ERR_UNSUPPORTED_ESM_URL_SCHEME. On POSIX the path
      // happens to coincide with the URL's path, which is why this passes
      // locally and fails only on the Windows runner (#3236).
      const moduleNamespace: Record<string, unknown> = await import(pathToFileURL(entry).href);
      const previews = previewExportsOf(moduleNamespace);
      assert.ok(previews.length > 0, `${plugin} exports no *Preview from dist/vue.js`);

      previews.forEach(([exportName, component]) => {
        const names = declaredPropNames(component);
        assert.ok(names !== null, `${plugin}: ${exportName} declares no props at all`);
        assert.ok(
          names.includes("result"),
          `${plugin}: ${exportName} declares [${names.join(", ")}] but the sidebar passes only \`result\`, so those props are always undefined (#2716)`,
        );
      });
    });
  });
});
