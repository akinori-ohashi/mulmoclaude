# Attached files

How to read the `[Attached file: …]` markers on a user message. The system prompt carries the rules; this page has the full detail.

When a user message carries one or more lines of the form

`[Attached file: <workspace-relative-path>]`

the user has attached / pasted / dropped a file (or selected one in the UI) for this turn. **Each line is one file** — when the user attaches multiple files in the same turn, you will see multiple consecutive marker lines, in declaration order. They usually sit before the user's actual message text, but on a slash-command turn they follow it (so the leading `/` stays at the very start for command resolution). Every path always points at a real workspace file:

- `data/attachments/YYYY/MM/<id>.<ext>` — paste/drop/file-picker uploads. The extension reflects the actual format (`.png`, `.pdf`, `.docx`, `.xlsx`, `.txt`, etc.). PPTX uploads are converted server-side and the path you receive is the resulting `.pdf`; the original `.pptx` lives next to it under the same `<id>` if you ever need to inspect it.
- `artifacts/images/YYYY/MM/<id>.png` — a generated / canvas / edited image the user selected from the sidebar.

Where possible, each file's bytes are also delivered to you as a vision / document content block on the same turn, so you can look at it directly without a tool round-trip. The path is still the source of truth — use it whenever you need to refer to the file by name.

Treat the markers as the source of truth for **which** files the user means when they say "this", "edit this", "summarise this doc", "turn this into …", "combine these", etc. If you call a tool that takes a workspace path (e.g. `editImages`, or `Read` to inspect a file the bytes weren't delivered for), pass the path verbatim from the marker. Do not echo the markers back in your reply, and do not invent a path when no marker is present.

When the user wants to transform existing images, call `editImages` with `imagePaths` set to an array of one or more workspace paths (single image: a one-element array). Pull the paths from the `[Attached file: …]` markers, from earlier tool results in this conversation, or from explicit paths the user mentions in plain text. When several markers are present and the request reads as a multi-image instruction ("combine these", "merge", "use both", etc.), include every relevant path in the array, in the order they appeared. `editImages` is fully stateless — it has no concept of a "currently selected" image, so the array is the only signal of which images to edit.

## Original filename

A marker may also carry the name the file had on the user's machine:

`[Attached file: data/attachments/2026/07/b458a5d0.csv (original name: 商品カタログ_v2.csv)]`

The stored name is a collision-proof id, so this is the only way you learn what the user actually calls the file. Use it when you **write** something back: "save this as a spreadsheet" should produce `商品カタログ_v2.xlsx`, not `b458a5d0.xlsx`. It is also the name to use when you mention the file in your reply — say the original name, not the id.

Two rules:

- **Never read or write the original name as a path.** It names the file, it does not locate it. Every filesystem operation goes through the `data/attachments/...` path in the marker.
- **When the extensions disagree, the path wins for content.** A PPTX upload arrives as `<id>.pdf` with `(original name: deck.pptx)` — the bytes really are a PDF. The original name still tells you what the user handed over, which is what they will call it.

Not every marker has one. A file the user selected in the sidebar, or one arriving from a bridge that does not send a name, appears as a bare `[Attached file: <path>]` — then the path is all you have, and asking the user what to call an output is reasonable.
