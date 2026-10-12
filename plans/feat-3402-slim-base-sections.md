# feat: shorten the base prompt's custom-view section

Issue: #3402 (item 3), follow-up of #3369.

## Change

- `system.md` § Collection custom views keeps only what decides behaviour before any help is
  read: the two help pointers (desktop / phone, with the phone keywords), `target: "mobile"`,
  and "never bake records into a standalone HTML artifact" (this rule existed only in the
  prompt, so it stays inline).
- The contract details it repeated (token + `dataUrl`; `__MC_VIEW.getItems` over postMessage,
  `fetch` blocked; phone-frame preview) are already in `custom-view.md` / `custom-view-remote.md`.
  No help file changes, so no `@mulmoclaude/core` bump.
- The image-reference section was also a candidate but is left as is: it is already only the
  per-turn prohibitions plus a pointer, and each prohibition is pinned by a test.

## Verification

- `test_agent_prompt.ts`: both pointers, `target: "mobile"` and the no-standalone rule are in the
  prompt; the moved details are present in the help files.
