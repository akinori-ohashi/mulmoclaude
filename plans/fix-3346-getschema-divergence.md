# fix: getSchema silently returns a staging schema the server is not running (#3346)

Reported in #3297 (item 2).

## Problem

The skill-bridge hook mirrors `data/skills/<slug>/` → `.claude/skills/<slug>/`
only for Write / Edit tool calls (for Bash it handles only `rm -rf`). A
`schema.json` written through Bash or a script stays in staging, and discovery
keeps serving the old active copy. `getSchema` reads staging first, so it shows
the new content — a schema the server is not running — with no hint of it.

## Fix

- A: extract the reply into a pure helper,
  `packages/core/src/collection/server/schemaReadReply.ts`. Staging, else
  active, as before — but staging only for a project collection: a same-slug
  `data/skills/<slug>/` next to a user-scope collection is not its authoring
  copy, and `putSchema` refuses user scope anyway. When both are readable and differ, prefix a
  `manageCollection: NOTE` naming both paths and pointing at `putSchema`. The
  JSON follows after a blank line so it stays copyable. The unchanged case
  keeps returning bare JSON.
- B: `error-recovery.md` section for "a `schema.json` change is not reflected —
  written with Bash or a script", fixed by `putSchema`.

## Out of scope

Mirroring arbitrary Bash writes from the hook — it would mean parsing arbitrary
commands or sweeping after every Bash call; a separate design question.

## Tests

- `packages/core/test/collection/test_schemaReadReply.ts` — the pure rule, both
  directions (identical / one missing / none / differing / empty file / slug).
- `packages/core/test/collection/test_authoringCoherence.ts` — a real tmpdir
  root with staging written behind the mirror's back: getSchema flags it, and
  putSchema clears it.
- `packages/core/test/collection/test_getSchemaUserScope.ts` — a user-scope
  collection with a same-slug workspace staging file: getSchema returns the
  collection's own schema, with no note.
