# plan: the spotify preview card throws instead of rendering

## What is wrong

`packages/plugins/spotify-plugin/src/Preview.vue` is registered as the plugin's
`previewComponent` and declares `selectedResult` — the prop name the **view**
slot takes. The sidebar passes `result`:

```
src/components/SessionSidebar.vue:64
  <component :is="…previewComponent" … :result="result" />
src/App.vue:183
  :selected-result="selectedResult"
```

So `props.selectedResult` is `undefined` at render, and the computed reads
`result.ok` off it with no guard.

## Reproduced, not inferred

Rendering the BUILT component the way the host renders it — `plugin.previewComponent`
from `dist/vue.js`, given only `{ result }` — throws:

```
TypeError: Cannot read properties of undefined (reading 'ok')
```

The runtime loader wraps every plugin component in `PluginScopedRoot`, which
registers `onErrorCaptured`, so the user does not see a blank card: they see the
red plugin-error panel, on every `manageSpotify` call that renders at all. Louder
than #2716's silent generic line, and equally broken.

## Where `ok` / `error` actually arrive — the part #3226 said to establish first

They arrive. The bridge spreads the plugin's whole return value into the posted
tool result:

```
server/agent/mcp-server.ts   await postJson(…, { ...result, toolName, uuid })
server/events/session-store/index.ts   pushToolResult stores and publishes it verbatim
```

Nothing picks fields, so `ok` / `error` / `message` / `data` all reach the
sidebar's `result` at runtime. They are absent from the `ToolResult` **type**,
not from the object.

**But `ok: false` can never reach this card.** The bridge only posts when
`result.data !== undefined`, and every failure return in `src/core/dispatch.ts`
is `{ ok: false, error, message }` with no `data` — checked at each of them. So
the `result.ok === false` branch is unreachable on the sidebar path and comes
out; the card renders only for successes.

## What actually arrives in `data`

Enumerated from `src/core/dispatch.ts` and `src/core/responses.ts`:

| kind | `data` |
|---|---|
| `connect` | `{ authorizeUrl }` |
| `status` | `{ connected, clientIdConfigured, … }` |
| `diagnose` | `{ clientIdConfigured, tokensPresent, … }` — **no `connected`** |
| `liked` / `playlists` / `playlistTracks` | `NormalisedTrack[]` / `NormalisedPlaylist[]` |
| `recent` | `RecentlyPlayedItem[]` |
| `nowPlaying` | `NormalisedTrack` or `null` |
| `search` | `SearchResult` |
| `getDevices` | `NormalisedDevice[]` |
| other player kinds, `configure`, `oauthCallback` | none — no card |

Two of those the current component does not handle: `getDevices` falls through
`summariseArray`'s element checks and reads as "*N* tracks", and `diagnose` has no
`connected` key so it lands on the generic line.

## Shape

Follow what #2716 established for accounting, which is now the house pattern:

- **`src/previewSummary.ts`** — pure, Vue-free, takes `data: unknown` plus the
  label subset it needs. Narrows with type guards rather than `as`. Reachable
  from `tsx --test`, which cannot load an SFC — the reason the accounting bug
  survived a year of green unit tests.
- **`Preview.vue`** — `defineProps<{ result: ToolResultComplete }>()`, template
  plus one `computed` that calls it. Same prop as every other packaged preview.

## Guard

`test/plugins/test_previewComponentProps.ts` holds `spotify` out by name. The
hold-out list is itself asserted, so removing the entry is part of the fix and
cannot be forgotten.

**And the census was checking the wrong object.** It read named `*Preview`
exports, but the host's runtime loader reads `plugin.previewComponent` — a
different property that need not hold the same component. Spotify exports no
`Preview` at all, which is the other half of why it could not simply join the
list. The census now gathers both and requires both to declare `result`, so it
checks what actually ships for every plugin, not only for spotify.

## Two defects the tests found on the way

Neither is introduced here; both are in the code being replaced, and both would
have shipped the moment the card started rendering:

- **A now-playing track rendered as a search tally.** `NormalisedTrack` carries
  an `artists` array, and the search guard matched on key presence, so one track
  came out as "1 Artists". The track guard now runs first.
- **A non-array category was counted by its string length.** `"nope".length` is
  4, so a malformed `tracks` reported four hits. Both the guard and the per-
  category count now require an array.

`getDevices` also read as "*N* tracks", because the element checks knew only
playlists and recently-played. It has a branch now; the `devices` label already
existed.

## Verification

- **Rendered, not reasoned.** The built component is driven through the host's
  own prop (`plugin.previewComponent` from `dist/vue.js`, given only `result`)
  for every shape in the table above. Before: `TypeError: Cannot read properties
  of undefined (reading 'ok')`. After: each shape produces its own line.
- **Break-verified, each mutation confirmed to have landed in the file before
  measuring, and the source checksum-restored after.** Five: reverting the prop
  name (the census goes red and names `plugin.previewComponent`), putting the
  search guard back ahead of the track guard, dropping the device branch,
  returning `isSearchResult` to a key-presence check, and dropping the array
  check from the per-category count. The last of those did NOT go red at first —
  the payload it protects against cannot reach that code unless another category
  IS an array, so the case was added rather than the guard claimed.
- Both directions for the pure summariser: each shape that arrives, and the
  abnormal inputs — null, undefined, primitives, empty array, an array of
  something unrecognised, a record whose `name` is not a string.

## Not in scope

- **The `<style scoped>` block.** The house rule is Tailwind utilities, but this
  plugin is runtime-loaded and ships its own `dist/style.css`; its build has no
  Tailwind, unlike `accounting-plugin`'s. Converting means adding Tailwind to
  this package's build, which would change how the card looks — the thing this
  PR is fixing. Costed and declined; it is its own change.
- `View.vue`, which takes `selectedResult` correctly and is not affected.
