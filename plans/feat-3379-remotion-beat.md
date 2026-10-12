# feat: remotion beats in the mulmoscript-plugin tool description (#3379)

## Goal

mulmocast 2.13.0 adds `image: { type: "remotion", prompt, fps? }` plus a script-level
`remotionParams.brief`. Teach the agent about it through `presentMulmoScript`'s tool
description, without making it a default choice.

## Changes

1. `packages/plugins/mulmoscript-plugin/src/core/definition.ts` — add `remotion` to
   "Beat visual options", NOT marked PREFER: use only when the user asks for Remotion or is
   known to have it installed (the remotion packages are optional mulmocast deps the host does
   not ship; without them generation fails). Mention the cost (several `claude -p` calls per
   scene), `remotionParams.brief`, and that it cannot be combined with `moviePrompt`.
2. Dependency floors to `^2.13.0` for `mulmocast` / `@mulmocast/types`: plugin peers, root
   and launcher (the launcher must satisfy the plugin's peer range).
3. View: `beatMayHaveMovie` (`src/vue/helpers.ts`) only knew `moviePrompt` and animated
   `html_tailwind`, so a remotion beat's `_animated.mp4` was never probed. Add `remotion`.
   Paths need nothing new: mulmocast writes remotion output to
   `getBeatAnimatedVideoPath` (only once the beat's duration is known; before that it writes
   only the still), and the still lands on the normal beat `.png` path. Preview shows only
   title/description — no change.
4. `beatMovieOp` picks the beat's own clip by kind (`src/server/beatMovieCandidates.ts`): a
   plugin-video beat (animated `html_tailwind`, `remotion`) uses `_animated.mp4`, any other beat
   the moviePrompt `.mov`, so a clip left over from the beat's earlier kind is never shown.
5. Lockfile: `yarn add` dropped the root `resolutions` (incl. the patched `@xmldom/xmldom`);
   a follow-up `yarn install` re-applied them.

## Not in scope

- Installing remotion packages in the host.
- MulmoTerminal guidance (receptron/mulmoterminal#2904).
