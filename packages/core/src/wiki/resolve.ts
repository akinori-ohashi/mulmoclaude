// The one rule for "does this `[[link]]` target name an existing page?".
// Shared by the page resolver, the lint, and the graph so the three
// cannot disagree on which files a target can reach.
//
// Pure string + lookup work; safe to import from browser bundles.

import type { WikiPageEntry } from "./index-parse.js";
import { wikiSlugify } from "./slug.js";

/** Anything that can answer "do you hold this slug?" — the page index
 *  (`Map<slug, filename>`) and the lint's `Set<slug>` both qualify. */
export interface SlugLookup {
  has: (slug: string) => boolean;
}

/** Match a raw link target against known page slugs, returning the
 *  matched slug or null.
 *
 *  Literal first: page slugs ARE filename stems, so a non-ASCII page
 *  only ever matches its own untouched name — `wikiSlugify` strips
 *  every non-ASCII character and would reduce `不耕起栽培-カバークロップ4年計画`
 *  to `-4` (#2940). The slugified form still runs second so
 *  `[[Sakura Internet]]` keeps resolving to `sakura-internet.md`. */
export function matchWikiSlug(target: string, known: SlugLookup): string | null {
  const literal = target.trim();
  if (literal.length === 0) return null;
  if (known.has(literal)) return literal;
  const slug = wikiSlugify(literal);
  if (slug.length > 0 && known.has(slug)) return slug;
  return null;
}

/** index.md title → slug, first entry wins. The fallback for links
 *  written as the display title rather than the page's own name. */
export function slugByIndexTitle(entries: readonly WikiPageEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  entries.forEach((entry) => {
    if (entry.title.length > 0 && !map.has(entry.title)) map.set(entry.title, entry.slug);
  });
  return map;
}

/** Resolve a raw `[[link]]` target to an existing page slug, or null:
 *  known slug first, then an index entry's title. Every consumer that
 *  judges whether a link points at a real page — the graph and the
 *  lint — shares this, so a link cannot be an edge in one and a broken
 *  link in the other. */
export function resolveLinkTarget(target: string, fileSlugs: SlugLookup, slugByTitle: ReadonlyMap<string, string>): string | null {
  const matched = matchWikiSlug(target, fileSlugs);
  if (matched !== null) return matched;
  const byTitle = slugByTitle.get(target.trim());
  return byTitle !== undefined && fileSlugs.has(byTitle) ? byTitle : null;
}
