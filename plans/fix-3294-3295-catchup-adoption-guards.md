# fix: adopt a catch-up snapshot only when it is complete and current (#3294, #3295)

## Problem

`refreshSessionTranscript` replaced the client transcript whenever the server copy was
richer (`shouldAdoptServerTranscript`). Two situations make that unsafe:

- **#3294 (mid-run).** Reconnect and visibility catch-ups run while a turn streams. The
  server JSONL does not yet hold the text being streamed: `flushTextAccumulator` writes it
  only when a non-text event arrives or the run ends. So a mid-run snapshot is missing the
  card the user is watching, and adopting it drops that card. It also leaves
  `runStartIndex` and `assistantTextInterrupted` describing the old list.
- **#3295 (stale snapshot).** Live events that arrive while the fetch is in flight are not
  in the snapshot. Adopting it drops them until the next refresh.

## Change

- **Server** (`server/api/routes/sessions.ts`): the detail response's `session_meta`
  row, now always present, carries `isRunning` from the session store. It is read both
  before and after the file read, so a run that starts or ends mid-read still marks the
  snapshot as possibly incomplete.
- **Client** (`src/utils/session/catchUpGuard.ts`, pure):
  - "Running" means the server's mid-run flag OR the client's own `isRunning`. The
    client's flag only mirrors the session list and can lag, even for this tab's own
    run.
  - Current means the transcript has not changed since the fetch started, checked by
    a shallow snapshot (each card's object, `message` and `data` references). Every
    live mutator replaces one of these (append, `Object.assign`, slot replacement),
    so no mutation site has to keep a counter. The tests drive the real mutators.
  - `decideCatchUpAdoption`: `running`, then `stale`, then `not-richer`, else
    `adopt`.
- **Missed `session_finished`:** `refreshSessionStates` reports each session it flips
  from running to stopped (`applySessionSummary`), and `App.vue` routes that to
  `handleSessionFinished` itself (refresh, then mark read or unsubscribe).
  - It ignores a failed fetch, which returns the cached list; a cached "stopped" is
    not news, and applying it would hide the real stop later.

## Decision (#3294's "to decide")

The issue offered two options: skip adoption while running, or recompute `runStartIndex`
from the alignment. **Skipping is the only complete option**, because recomputing run
state cannot restore streamed text the snapshot does not contain. The cost is that cards
missed mid-run appear when the turn ends, not at reconnect.

## Verification

- `applySessionSummary` was extracted from the `refreshSessionStates` loop. The old body
  and the helper were run side by side over every input combination with no difference;
  that enumeration stays as a permanent test.
- Each guard rule has a test that goes red when the rule is removed.
