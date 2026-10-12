# fix: CLI-injected context must not become reply text (#3376)

## Problem (measured, Claude Code 2.1.284)

With no Skill call pending, a `user`-role text block is still treated as assistant text by
`handleInjectedText()` (`server/api/routes/agent.ts`): it is published as `text` and
accumulated, so it reaches the bridge reply (`collectAgentReply` concatenates `text`), the
Web UI live stream, the session jsonl (`source: "assistant", type: "text"`) and the turn-end
Web Push body.

Captured with the spawn flags MulmoClaude uses, two CLI injections take that path every time:

- output-limit continuation ("Output token limit hit. Resume directly…") — `user` frame,
  array content, `isSynthetic: true`
- mid-turn autocompact summary ("This session is being continued…") — after
  `system/compact_boundary`, `user` frame, array content, `isSynthetic: true`

`isCompactSummary` is not on the emitted frame, and the SKILL.md body frame also carries
`isSynthetic: true`, so no frame flag separates the cases. Whether a Skill call is pending is
the only discriminator, which the code already tracks.

## Change

1. `server/agent/injectedText.ts` (new, pure): `classifyInjectedText(pendingSkill)` →
   `{ kind: "skill-body", skill }` or `{ kind: "cli-context" }`.
2. `handleInjectedText()` routes through it. `cli-context` is logged (info, preview + size)
   and is NOT published, accumulated, or written to the jsonl. The CLI keeps it in its own
   session transcript, so nothing is lost.
3. `test_skillBridgeReply.ts` mirrored the server's decision in a local copy, which already
   dropped the non-Skill case, so it stayed green while the real code leaked. Route the
   mirror through `classifyInjectedText` too.

## Tests

- Fixtures trimmed from the real captures: `cli-stream-output-limit.jsonl`,
  `cli-stream-autocompact.jsonl` (`system` / `stream_event` / `rate_limit_event` frames
  dropped, long contents truncated, ids and paths replaced).
- Parser: both fixtures yield `injected_text`, never `text`, for the injected blocks.
- `handleAgentEvent` on a temp workspace: after feeding each fixture, the text accumulator,
  `lastAssistantText` and the jsonl hold only the assistant's own text.
- `classifyInjectedText` both ways.

## Not in scope

- A collapsed UI card for CLI context (needs a new entry type, UI plugin and 8-locale i18n).
- String-content `user` frames (manual `/compact`, `<local-command-stdout>`): the parser
  already drops them.
