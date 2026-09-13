// Test helper — installs a Vue-free plugin host context so plugin
// code that calls `pluginEndpoints(...)` / `pluginBuiltinRoleIds()`
// / etc. doesn't throw "context not installed" in unit tests.
//
// Differs from `src/main.ts`'s production install in two ways:
//
//   - `getAllPluginNames` is stubbed (returns `[]`). The real one
//     pulls in `src/tools/index.ts` which transitively imports Vue
//     plugin components — and `tsx --test` can't load `.vue` files.
//     Tests that exercise plugin enumeration can override.
//   - `pageRoutes` and `builtinRoleIds` are pulled from
//     `src/config/*` which are Vue-free constants.
//
// Call once per test file (or once globally before any plugin
// import). The DI registry is module-level state; installing
// twice replaces the prior install.

import { installHostContext, type EndpointRegistry, type HostContext } from "../../src/plugins/api.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";
import { CHAT_MODELS } from "../../src/config/models.js";
import { BUILTIN_ROLE_IDS } from "../../src/config/roles.js";
// Import from the leaf file (not `src/router/index.ts`) so the test
// helper doesn't transitively load `vue-router`'s `createRouter`,
// which touches `window` at module init.
import { PAGE_ROUTES } from "../../src/router/pageRoutes.js";

export function installTestHostContext(overrides: Partial<HostContext> = {}): void {
  const registry: EndpointRegistry = {
    // todos: removed (#1145) — runtime plugin uses dispatch directly
    scheduler: API_ROUTES.scheduler,
    mulmoScript: API_ROUTES.mulmoScript,
    skills: API_ROUTES.skills,
    html: API_ROUTES.html,
    chart: API_ROUTES.chart,
    accounting: API_ROUTES.accounting,
    canvas: API_ROUTES.canvas,
    form: API_ROUTES.form,
    markdown: API_ROUTES.markdown,
    spreadsheet: API_ROUTES.spreadsheet,
    wiki: API_ROUTES.wiki,
    roles: API_ROUTES.roles,
    image: API_ROUTES.image,
    files: API_ROUTES.files,
    imageStore: { update: API_ROUTES.image.update },
    mcpTools: { list: API_ROUTES.mcpTools.list },
  };

  installHostContext({
    endpoints: registry,
    builtinRoleIds: BUILTIN_ROLE_IDS,
    pageRoutes: PAGE_ROUTES,
    getAllPluginNames: () => [],
    chatModels: CHAT_MODELS,
    ...overrides,
  });
}
