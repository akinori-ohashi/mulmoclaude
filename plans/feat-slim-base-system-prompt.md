# feat: slim the base system prompt

Issue: #3369 (step 1 of the plan posted there).

## Problem

`server/prompts/system/system.md` is sent on every turn and has grown to about 11,500
characters. Three sections are reference material needed only in specific situations:
attached-file markers, image references in `.md` / `.html`, and task scheduling.

## Change

- Move each section's full text, verbatim, into a help file under
  `packages/core/assets/helps/` (`attachments.md`, `image-references.md`, `scheduling.md`),
  seeded into `config/helps/` at startup. Listed in `helps/index.md`.
- Replace each section in `system.md` with the rules the agent must follow without reading
  anything (pass marker paths verbatim, relative image paths, `daily HH:MM` is UTC) plus a
  `Read config/helps/<name>.md` pointer.
- The path is workspace-relative; the agent's cwd is the workspace with and without Docker
  (`/home/node/mulmoclaude` in the container), so it resolves in both.
- Sections kept inline: file links in replies (pinned by a test, used on most replies),
  clarifying questions, error recovery, custom views (already a pointer).
- `assets/helps` changed → `@mulmoclaude/core` 5.9.1, ranges swept, CHANGELOG Ships line.

## Verification

- Existing prompt tests and the helps registry test.
- Live: an attached image turn and a "schedule this daily" turn still behave.
