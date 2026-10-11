# fix: code-copy button inside a Shadow DOM (#3448)

## Problem

`installCodeCopyHandler` attaches one delegated `click` listener to the
document. `handleClick` found the button with `event.target.closest(...)`.
A click inside a shadow root reaches a document-level listener with
`event.target` retargeted to the shadow host, so `closest` never meets the
button and the click does nothing. MulmoTerminal mounts plugin views in an
open shadow root, so its canvas code blocks cannot be copied.

## Fix

Look the button up in `event.composedPath()` — for an open shadow root the
path holds the real button. The lookup runs synchronously, before the
first `await`, because the path is emptied once dispatch ends.

Nonce check is unchanged: an element inside a shadow root has the outer
document as `ownerDocument`, so it is compared against the same nonce.

Closed shadow roots stay unsupported (the path is retargeted there too);
neither host uses one.

## Tests (`test/utils/markdown/test_codeCopyClipboard.ts`)

- A legitimate button inside an open shadow root copies, also when the
  click lands on the icon inside it.
- A button inside a shadow root with no nonce / a wrong nonce copies nothing.

## Release

`@mulmoclaude/markdown-utils` patch bump, published via `/publish`
(separately, after merge). MulmoTerminal then needs the new version.
