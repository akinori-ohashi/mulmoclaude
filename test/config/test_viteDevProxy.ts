// The dev proxy is the only thing keeping an iframe `src` off Vite's SPA catch-all,
// and the failure is silent in the worst way: index.html answers 200, so the pane
// renders blank and the console blames CORS on `/@vite/client` (#2928 — `/htmlfile`
// had been missing since the mount was added, while `/artifacts/html` beside it was
// fine, so build, lint and test all stayed green).
//
// So the check is against the URLs the View ACTUALLY builds, not a second list of
// prefixes: a new URL shape from the plugin fails here rather than in a blank pane.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { htmlArtifactPreviewUrl, htmlFileUrl } from "@mulmoclaude/html-plugin";
import viteConfig, { PROXIED_BACKEND_PREFIXES } from "../../vite.config.js";

const proxyPrefixes = Object.keys(viteConfig.server?.proxy ?? {});

const isCoveredBy = (prefixes: readonly string[], url: string): boolean => prefixes.some((prefix) => url === prefix || url.startsWith(`${prefix}/`));

/** Every URL shape `packages/plugins/html-plugin/src/vue/View.vue` can put in its
 *  iframe `src`, built by the same helpers the View calls. */
const iframeSources: readonly (readonly [string, string | null])[] = [
  ["a page presentHtml wrote", htmlArtifactPreviewUrl("artifacts/html/2026/08/report.html")],
  ["an absolute path presentHtml was pointed at", htmlFileUrl("/Users/someone/proj/demo.html")],
  ["a workspace-relative path presentHtml was pointed at", htmlFileUrl("docs/report.html")],
  ["a Windows absolute path presentHtml was pointed at", htmlFileUrl("C:\\proj\\demo.html")],
];

/** The two mounts whose handler emits the preview CSP from `browserVisibleOrigin(req)`
 *  (server/index.ts). `changeOrigin` hides the browser's Host from Express, so without
 *  `xfwd` the CSP names the backend and Safari blocks every subresource the page pulls
 *  (#991) — a failure no URL-coverage check can see. */
const CSP_ORIGIN_MOUNTS = ["/artifacts/html", "/htmlfile"] as const;

const proxyOptionsFor = (prefix: string): { changeOrigin?: boolean; xfwd?: boolean } | null => {
  const entry = viteConfig.server?.proxy?.[prefix];
  return typeof entry === "object" ? entry : null;
};

describe("vite dev proxy", () => {
  iframeSources.forEach(([label, url]) => {
    it(`forwards the iframe src for ${label} to the backend`, () => {
      assert.notEqual(url, null, `the html plugin built no URL for ${label} — the fixture path no longer qualifies`);
      assert.equal(isCoveredBy(proxyPrefixes, url ?? ""), true, `${url} is not proxied — Vite's SPA catch-all would answer it with index.html`);
    });
  });

  CSP_ORIGIN_MOUNTS.forEach((prefix) => {
    it(`forwards the browser-visible origin on ${prefix}`, () => {
      const options = proxyOptionsFor(prefix);
      assert.notEqual(options, null, `${prefix} has no proxy entry to carry the forwarded origin`);
      assert.equal(options?.changeOrigin, true, `${prefix} no longer rewrites Host — the xfwd reasoning below assumes it does`);
      assert.equal(options?.xfwd, true, `${prefix} drops X-Forwarded-*, so its CSP would name the backend origin instead of the browser's`);
    });
  });

  // The LAN guard is a SECOND list, and a prefix proxied without being guarded is
  // reachable from the network whenever MULMOCLAUDE_DEV_LAN is set — these mounts
  // are deliberately bearer-exempt, so the loopback check is their only protection.
  it("guards every proxied prefix against non-loopback callers", () => {
    proxyPrefixes.forEach((prefix) => {
      assert.equal(
        isCoveredBy(PROXIED_BACKEND_PREFIXES, prefix),
        true,
        `${prefix} is proxied to the backend but no PROXIED_BACKEND_PREFIXES entry covers it — it would be reachable from the LAN`,
      );
    });
  });
});

// #2981 — the proxy follows the port the backend published, but ONLY when a
// `yarn dev` that also started that backend says so.
//
// The guarantee is the dev chain's, not the file's: `yarn dev` clears
// `.server-port` before either pane starts and waits for this run's publish, so
// what Vite reads is current. `yarn dev:client` / `dev:client:e2e` run Vite with
// no backend and no reset, so the same file would be a leftover pointing at a
// port nothing is on. The wiring that separates the two is a single env var in
// package.json, which nothing else would catch if it were dropped.
describe("published-port following is opt-in per dev script", () => {
  const { scripts }: { scripts: Record<string, string> } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
  const FOLLOW = "MULMOCLAUDE_DEV_FOLLOW_PORT=1";

  ["dev", "dev:debug", "dev:full-build"].forEach((name) => {
    it(`${name} starts Vite with the backend it launched, so it follows`, () => {
      assert.match(scripts[name] ?? "", new RegExp(`${FOLLOW}\\s+vite`), `${name} must opt Vite into following the published port`);
    });

    it(`${name} clears the stale port before either pane starts`, () => {
      assert.match(scripts[name] ?? "", /wait:backend --reset/, `${name} must reset .server-port so the publish is attributable`);
    });
  });

  ["dev:client", "dev:client:e2e"].forEach((name) => {
    it(`${name} runs Vite alone, so it must NOT follow`, () => {
      assert.doesNotMatch(scripts[name] ?? "", /MULMOCLAUDE_DEV_FOLLOW_PORT/, `${name} has no backend of its own; a published port would be a leftover`);
    });
  });
});
