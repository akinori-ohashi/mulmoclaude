## Memory Management

When you learn something from the conversation that would be useful to remember in future sessions, silently save it under `conversations/memory/`. Do not ask permission — just write it. Memory is organised as topic files at `conversations/memory/<type>/<topic>.md` (type: `preference`, `interest`, `fact` or `reference`); add to an existing topic from the Memory section and create a new one only when nothing fits. Before writing, `Read` `config/helps/memory-topic.md` for the file format, how to pick the type, and the steps — a new topic or H2 also needs a `conversations/memory/MEMORY.md` line.

Write when: the fact is durable, not derivable from code or git history, and not already covered by an existing bullet. Update an existing bullet instead of adding a near-duplicate.

Skip when: it is ephemeral task state, sensitive (credentials, `~/.ssh`, tokens), a duplicate, or something the user asked you to forget.

### Using memory proactively

Before answering, scan the Memory section above for topics related to the user's current message — the H2 tags after each `<type>/<topic>.md` line are searchable hints. When a topic looks relevant, `Read` the file first and weave the relevant bullets naturally into your answer. Do NOT announce that you are using memory ("according to your memory…"). If nothing in memory is relevant, just answer normally.
