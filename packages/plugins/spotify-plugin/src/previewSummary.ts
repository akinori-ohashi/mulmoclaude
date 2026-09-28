// The one line the sidebar's compact card shows for a `manageSpotify` result.
// Pure and Vue-free: `Preview.vue` is the template plus a `computed` that calls
// `summarisePreview`, so these branches are reachable from `tsx --test`, which
// cannot load an SFC. The card being unreachable from the unit tests is how
// #3226 (and #2716 before it) stayed broken.
//
// `data` arrives as `unknown`: the envelope is built server-side and replayed
// from the chat log, so a field has a type only once a guard below has looked.

import type { NormalisedDevice, NormalisedPlaylist, NormalisedTrack, RecentlyPlayedItem, SearchResult } from "./types";

/** The label subset the card needs, injected so this module stays free of Vue
 *  and of the locale wiring. Keys are a subset of `lang/en.ts`. */
export interface PreviewLabels {
  previewSummary: string;
  notConnected: string;
  notConfigured: string;
  connected: string;
  empty: string;
  emptyNowPlaying: string;
  tabPlaylists: string;
  tabRecent: string;
  tracksCount: string;
  devices: string;
  searchEmpty: string;
  searchTracks: string;
  searchArtists: string;
  searchAlbums: string;
  searchPlaylists: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// Each guard takes `unknown` rather than a narrowed record: `SearchResult` and
// the `Normalised*` interfaces have no index signature, so a predicate whose
// parameter is `Record<string, unknown>` is rejected outright (TS2677).

/** `status`'s payload. `diagnose` deliberately does NOT match: it reports
 *  `tokensPresent` rather than `connected`, so it is a different question and
 *  falls to the generic line rather than claiming a connection state. */
const isConnectionStatus = (value: unknown): value is { connected?: boolean; clientIdConfigured?: boolean } => isRecord(value) && "connected" in value;

const SEARCH_CATEGORIES = ["tracks", "artists", "albums", "playlists"] as const;

/** Search groups hits per category, each an array. Presence of the KEY is not
 *  enough: `{ tracks: "nope" }` would tally a string's `.length` as four hits,
 *  and a `NormalisedTrack` carries an `artists` array of its own — which is why
 *  a single now-playing track is matched before this guard, not after. */
const isSearchResult = (value: unknown): value is SearchResult => isRecord(value) && SEARCH_CATEGORIES.some((category) => Array.isArray(value[category]));

const isTrack = (value: unknown): value is NormalisedTrack => isRecord(value) && typeof value.name === "string";

const isPlaylist = (value: unknown): value is NormalisedPlaylist => isRecord(value) && "trackCount" in value;
const isRecentlyPlayed = (value: unknown): value is RecentlyPlayedItem => isRecord(value) && "playedAt" in value;
const isDevice = (value: unknown): value is NormalisedDevice => isRecord(value) && "isActive" in value;

/** Every listening kind and `getDevices` answer with an array, and the element
 *  shape is the only thing that says which — so a playlist page does not read
 *  as "5 tracks", and neither does a device list. */
function summariseArray(items: unknown[], labels: PreviewLabels): string {
  const [head] = items;
  if (head === undefined) return labels.empty;
  if (isPlaylist(head)) return `${items.length} ${labels.tabPlaylists}`;
  if (isRecentlyPlayed(head)) return `${items.length} ${labels.tabRecent}`;
  if (isDevice(head)) return `${items.length} ${labels.devices}`;
  return `${items.length} ${labels.tracksCount}`;
}

/** A category that is not an array contributes nothing — `"nope".length` is 4,
 *  so reading `.length` off whatever is there reported four hits. */
const countOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** Search groups its hits per category, so the card tallies them rather than
 *  naming one: "5 Tracks · 2 Artists". */
function summariseSearchResult(result: SearchResult, labels: PreviewLabels): string {
  const perCategory: [number, string][] = [
    [countOf(result.tracks), labels.searchTracks],
    [countOf(result.artists), labels.searchArtists],
    [countOf(result.albums), labels.searchAlbums],
    [countOf(result.playlists), labels.searchPlaylists],
  ];
  const parts = perCategory.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  return parts.length > 0 ? parts.join(" · ") : labels.searchEmpty;
}

function summariseConnectionStatus(status: { connected?: boolean; clientIdConfigured?: boolean }, labels: PreviewLabels): string {
  if (status.connected === true) return labels.connected;
  return status.clientIdConfigured === true ? labels.notConnected : labels.notConfigured;
}

/** `data` is `ToolResult.data` — the only place the payload arrives. There is no
 *  failure branch: the bridge posts a result only when `data` is present, and
 *  every failure return in `core/dispatch.ts` omits `data`, so a failed call
 *  renders no card at all rather than an error one. */
export function summarisePreview(data: unknown, labels: PreviewLabels): string {
  // `nowPlaying` answers with an explicit null when nothing is playing, which is
  // a result and not an absence — so it is checked before the record guards.
  if (data === null) return labels.emptyNowPlaying;
  if (Array.isArray(data)) return summariseArray(data, labels);
  if (isConnectionStatus(data)) return summariseConnectionStatus(data, labels);
  // Before the search guard: a track carries its own `artists` array, so a
  // now-playing track matched `isSearchResult` and rendered as "1 Artists".
  if (isTrack(data)) return data.name;
  if (isSearchResult(data)) return summariseSearchResult(data, labels);
  return labels.previewSummary;
}
