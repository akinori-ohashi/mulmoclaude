# feat: move the memory write procedure out of the system prompt

Issue: #3402 (item 1), follow-up of #3369.

## Problem

`memory-management-topic.md` / `-atomic.md` go into every role's system prompt on every turn.
Most of the text is the write procedure (file format, type examples, step lists), needed only
when the agent actually writes a memory entry.

## Change

- Move the full text, verbatim apart from "above" → "the system prompt's Memory section", into
  `packages/core/assets/helps/memory-topic.md` and `memory-atomic.md`, seeded into
  `config/helps/` at startup and listed in `helps/index.md`.
- Keep inline: save silently without asking, the path / filename shape and the four types,
  write-when / skip-when, and (topic layout) the proactive-recall paragraph — these apply on
  every turn, not only when writing. Add a `Read config/helps/memory-<layout>.md` pointer
  before writing.
- `assets/helps` changed → `@mulmoclaude/core` 5.11.1, ranges swept, CHANGELOG entry.

## Verification

- Prompt tests: each layout's section points at its help file; the help files carry the moved
  procedure (H2 sections, add/create steps, `MEMORY.md` line, atomic index-line form).
- Live: a turn that should save a memory still writes a correctly-shaped file.
