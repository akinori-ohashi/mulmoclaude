# fix: memory.md → atomic migration archives the file even when classification failed (#3457)

## Problem

`migrateLegacyMemory` always ends with `renameToBackup`. The LLM classifier turned every summarize
failure except `ClaudeCliNotFoundError` (non-zero exit, quota, auth, timeout) into `null`, which the
migration treats exactly like "the LLM judged this bullet too vague". So a boot that hits a usage
limit classifies nothing, writes nothing, archives `memory.md` to `.backup`, and from then on the
`.backup` marker stops every retry — the facts leave the prompt for good.

## Decision

- The classifier lets summarize failures throw. `null` now means only the LLM's own verdict
  (or an unreadable reply).
- `safeClassify` maps each candidate to `classified` / `skipped` / `failed`.
- If any candidate `failed`, the migration writes nothing and does not rename: `memory.md` stays
  readable in atomic mode and the next start retries. `MigrationResult.classifierFailures` reports it.
- `ClaudeCliNotFoundError` still escapes the whole migration, as before.

Out of scope: prose (non-bullet) lines in `memory.md` are still dropped by `parseCandidates`; an
unreadable LLM reply still counts as a skip.

## Tests

- migrate: one throwing classification → no entries, no `.backup`, `classifierFailures` = 1;
  all-`null` verdicts still archive.
- run: a generic summarize error leaves `memory.md` byte-identical and creates no `.backup`.
- classifier: a summarize error rejects instead of resolving `null`.
