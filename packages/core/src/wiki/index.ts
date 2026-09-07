// Browser-safe wiki engine — the must-not-drift logic shared by
// MulmoClaude and MulmoTerminal. String-only; NO `node:*` imports
// anywhere reachable from here (Node-only path helpers live under
// `@mulmoclaude/core/wiki/server`).
//
// Surfaces: `[[link]]` parsing, slug rules, index.md parsing, lint
// rules, the page→page graph, the URL ↔ domain route mapping, and
// the `[[link]]` → HTML renderer.

export { WIKI_LINK_PATTERN, parseWikiLink, type WikiLink } from "./link.js";
export { isSafeSlug, wikiPageStem, wikiSlugify } from "./slug.js";
export { matchWikiSlug, resolveLinkTarget, slugByIndexTitle, type SlugLookup } from "./resolve.js";
export {
  type WikiPageEntry,
  BULLET_LINK_PATTERN,
  BULLET_WIKI_LINK_PATTERN,
  buildTableColumnMap,
  extractHashTags,
  extractSlugFromBulletHref,
  parseIndexEntries,
  parseTagsCell,
} from "./index-parse.js";
export { findBrokenLinksInPage, findMissingFiles, findOrphanPages, findTagDrift, formatLintReport } from "./lint.js";
export { type WikiGraph, type WikiGraphNode, type WikiGraphEdge, type WikiPageContent, buildWikiGraph, incomingLinks, pageOutgoingSlugs } from "./graph.js";
export {
  type WikiAction,
  type WikiRouteSection,
  type WikiTarget,
  WIKI_ACTION,
  WIKI_ROUTE_SECTION,
  buildWikiRouteParams,
  isSafeWikiSlug,
  readWikiRouteTarget,
  wikiActionFor,
} from "./route.js";
export { escapeHtml, renderWikiLinks } from "./render.js";
