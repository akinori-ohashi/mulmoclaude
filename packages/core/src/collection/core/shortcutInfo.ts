// The one place an index row becomes the `{slug,title,icon,color}` a pinned
// shortcut reconciles against.
//
// Both the collections index and the feeds index did this inline, and the
// awkward part is identical in each: `color` must be ADDED only when there is
// one, never assigned as `undefined` — the shortcut shapes declare it narrow
// (see `CollectionSummary.color`) because the remote-host handlers pass them
// through `Jsonify`, which drops `undefined` from a member union. Writing that
// out twice is how the two copies drift.

import type { CollectionShortcutInfo } from "./uiTypes";

/** The fields an index row supplies. Both `CollectionSummary` and
 *  `FeedSummary` satisfy it; `icon` is optional because a feed row may carry
 *  an empty one and rely on the surface's default. */
export interface ShortcutInfoSource {
  slug: string;
  title: string;
  icon?: string | undefined;
  color?: string | undefined;
}

/** An index row as shortcut-reconcile input. `fallbackIcon` stands in when the
 *  row names no icon (feeds do this); `color` is omitted entirely rather than
 *  set to `undefined` when the row has none. */
export function toShortcutInfo(row: ShortcutInfoSource, fallbackIcon: string): CollectionShortcutInfo {
  return {
    slug: row.slug,
    title: row.title,
    icon: row.icon && row.icon.length > 0 ? row.icon : fallbackIcon,
    ...(row.color === undefined ? {} : { color: row.color }),
  };
}
