// Shared artifact-path builders for the presentation plugins (chart / html /
// mulmoscript / markdown) and the host's file stores. Browser-safe by design:
// no node:path / no node:crypto, so it bundles into both the server core and
// the browser (`./vue`) plugin entries.
//
// The artifact-path half lives upstream so plugins outside this repo share it
// without importing MulmoClaude: the directory's name is gui-chat-protocol's
// (`ARTIFACTS_ROOT`, 2.3), and the slug / partition / path builder / traversal
// guard are `@gui-chat-plugin/common`'s. They are re-exported here so every
// existing `@mulmoclaude/core/artifacts` import keeps working unchanged.
//
// These are POSIX artifact *wire paths* — stored in JSON and used as the
// generic `files.artifacts` FileOps keys — so they must ALWAYS join with `/`
// regardless of host OS.

export { ARTIFACTS_ROOT } from "gui-chat-protocol";
export {
  buildArtifactRelPath,
  hasUnsafePathSegment,
  slugifyArtifact,
  toWorkspaceArtifactPath,
  yearMonthUtc,
  type ArtifactRelPathParams,
} from "@gui-chat-plugin/common";

// ── Presentable document paths (presentDocument / presentHtml `path`) ──
//
// The two present* tools accept a path to an EXISTING file to display and
// edit in place. That file is no longer necessarily an artifact the agent
// wrote: it can be any document in the workspace (MulmoTerminal's workspace
// IS the git project the user is working in) or, when the host allows it, an
// absolute path elsewhere on disk.
//
// Which of those a value is decides how the host resolves it, so the
// judgement lives here rather than in each plugin — the plugins may not
// import one another, and a predicate two of them spell differently is how
// "the write site accepts what the refresh site rejects" bugs start.

/** How a caller-supplied file path must be resolved. `null` = not a usable path. */
export type FilePathKind = "absolute" | "relative";

// `/x`, `C:\x` / `C:/x`, `\\server\share` (UNC), and the Windows root-relative
// `\dir\x` — which node's `path.resolve` on Windows sends to the drive root, so
// treating it as relative would mean the classification and the resolution
// disagreed about where the file is. Windows spellings are recognised on every
// platform: the value is produced by an LLM or a remote host, not by the local
// `path` module.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;

/** True when `value` names a location that does not depend on a base directory.
 *  Exported so a URL builder and a path resolver cannot disagree about which
 *  values are rooted. */
export function isAbsoluteFilePathValue(value: string): boolean {
  // One leading backslash covers both the UNC `\\server\share` and the Windows
  // root-relative `\dir\x`.
  return value.startsWith("/") || value.startsWith("\\") || WINDOWS_DRIVE_RE.test(value);
}

/**
 * Classify a caller-supplied path to a file the host may read and overwrite.
 *
 * Accepts one of `extensions` (compared case-insensitively) and rejects NUL
 * bytes and any `.` / `..` / empty segment — a relative path must be canonical
 * so it can be joined onto a root, and an absolute one must not climb, so
 * neither form can be re-pointed by traversal after the host has vetted it.
 * Returns `"absolute"` / `"relative"` so the host knows whether to resolve
 * against its workspace root, or `null` when the value is unusable.
 *
 * This is a LEXICAL check only. Existence, file-vs-directory, symlink
 * containment and any host policy about which roots are reachable stay with
 * the host, which is the only layer that can consult the filesystem.
 */
export function classifyFilePath(value: string, extensions: readonly string[]): FilePathKind | null {
  if (!value || value.includes("\0")) return null;
  const lower = value.toLowerCase();
  if (!extensions.some((ext) => lower.endsWith(ext))) return null;
  const absolute = isAbsoluteFilePathValue(value);
  // Split on both separators: `..` must be refused however the value spells it.
  const segments = value.split(/[/\\]/);
  // A leading `/` (or drive / UNC prefix) makes the first segment empty by
  // construction — skip those, then require every remaining segment to be a
  // real name.
  const body = absolute ? segments.slice(segments.findIndex((segment) => segment.length > 0)) : segments;
  if (body.length === 0) return null;
  if (body.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return absolute ? "absolute" : "relative";
}

/** True when any `/` or `\`-separated segment starts with a dot. The file
 *  servers that hand these pages to a browser refuse dotfile segments (the
 *  artifact mounts' `dotfiles: "deny"` policy), so a `path` argument bearing
 *  one can be accepted by a tool and then never render — the gate and the
 *  server have to agree on this, hence one definition. */
export function hasDotfileSegment(value: string): boolean {
  return value.split(/[/\\]/).some((segment) => segment.startsWith("."));
}
