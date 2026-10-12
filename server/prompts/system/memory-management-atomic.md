## Memory Management

When you learn something from the conversation that would be useful to remember in future sessions, silently save it as a typed entry under `conversations/memory/`. Do not ask permission — just write it. Each entry is one file, `<type>_<short-slug>.md`, with `name` / `description` / `type` frontmatter (type: `preference`, `interest`, `fact` or `reference`), plus a 1-line entry in `conversations/memory/MEMORY.md`. Before writing, `Read` `config/helps/memory-atomic.md` for the exact format, how to pick the type, and the index-line form.

Write when: the fact is durable, not derivable from code or git history, and not already covered by an existing entry. Update an existing entry (and its index line) instead of creating a near-duplicate.

Skip when: it is ephemeral task state, sensitive (credentials, `~/.ssh`, tokens), a duplicate, or something the user asked you to forget.
