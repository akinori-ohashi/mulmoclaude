# fix: phone `allowSendChat` help text (#3268)

## Problem

`packages/core/assets/helps/custom-view-remote.md` and `custom-view.md` say the phone
always sends a view's `startChat` prompt. Since #3249 / receptron/mulmoserver#273 the
phone follows the view's `allowSendChat` declaration (undeclared ⇒ draft). The agent
reads these helps when it writes a view, so it leaves the flag off and the view drafts
on the phone.

## Change

- `custom-view-remote.md`: API comment and the "Starting a chat" section state the
  declaration rule and show the `views[]` entry with `allowSendChat: true`.
- `custom-view.md`: the phone bullet points at the same rule.
- `CollectionRemoteViewPreview.vue`: the emit doc comment drops the "phone always runs it" claim.
- CHANGELOG entry.

## Out of scope

- Publishing `@mulmoclaude/core` (the helps ship in `assets/`) — done with the next core release.
