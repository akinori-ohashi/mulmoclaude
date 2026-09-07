// Type declarations for check-doc-links.mjs. Sidecar so the script stays plain
// JS (runnable with `node` on a fresh clone) while tests get a typed import
// surface — same arrangement as scripts/packages/audit-releases.d.mts.

/** Every `.md` file under `dir`, recursively. */
export function markdownFilesUnder(dir: string): string[];

/** Whether a link target names something on disk this gate can resolve. False
 *  for URLs, anchors, `data:` blobs, API routes, and the bare filenames docs
 *  use as examples of what a USER would type. */
export function isCheckableTarget(target: string): boolean;

/** `text` with fenced blocks and code spans blanked to spaces (length
 *  preserved), so markdown that is being SHOWN is never read as a link. */
export function withoutCode(text: string): string;

/** Every checkable link target in `text`, anchors stripped, code ignored. */
export function linkTargetsIn(text: string): string[];
