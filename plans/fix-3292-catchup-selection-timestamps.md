# fix: keep selection and timestamps when catch-up adopts the server transcript (#3292)

## Problem

`refreshSessionTranscript` adopts the server copy by replacing `session.toolResults` only.
`parseSessionEntries` gives every text / skill / error card a fresh uuid on each parse,
so after adoption:

- every text card's `resultTimestamps` entry is orphaned (export and sidebar lose the time);
- a `selectedResultUuid` pointing at a text card no longer exists, so `App.vue`'s
  `selectedResult` becomes `null` and nothing is shown as selected.

## Change

`src/utils/session/adoptTranscript.ts` (pure):

- **Card identity is exact**: the same uuid (tool results keep theirs), or the same
  text kind and title with an identical body (a skill card's body is `data.body`,
  not its description).
- **Only the client's last card may match a longer server body**, because a dropped
  frame can only truncate the card still streaming (#2096). When more than one
  server card could continue it, it is left unmatched instead of guessed.
- **`alignServerToClient` is the order-preserving alignment with the most matched
  cards** (an LCS-style table, where an exact match outweighs a continuation). The
  shared prefix is matched in lockstep first, so the table covers only the part
  after the first difference.
  - Client-only cards (a local error `App.vue` never persisted) are skipped without
    stalling the rest.
  - Past a size cap, the remainder is left unaligned (it gets adoption-time stamps)
    rather than allocating an unbounded table.
- **`adoptServerTranscript`**: a matched card keeps the client's timestamp, and a
  recovered card gets the adoption time. Selection:
  - a user on the last card follows to the new last card;
  - any other selection is kept, on its new uuid;
  - a selection whose card is gone falls back to the last card.

`useSessionLifecycle.ts` applies all three fields.

## Decisions (the issue's "to decide")

- Follow the tail only when the user was on the last card, so a deliberate earlier
  selection is never stolen.
- A recovered card is stamped with the adoption time rather than an interpolated one. It
  arrived now as far as this client is concerned, and interpolation would reorder
  existing times.

## Out of scope

- Client-only cards are still dropped from the list on adoption, as before; the
  server copy is the one kept.
- Run state (`runStartIndex`, `assistantTextInterrupted`) during a mid-run adoption
  is a separate issue: #3294.
