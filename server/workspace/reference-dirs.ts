// User-defined reference directories (#455).
//
// Loaded from `config/reference-dirs.json`. Users can specify external
// directories that the agent can read (but not write to).
//
// Docker mode: mounted as `:ro` — filesystem-enforced read-only.
// Non-Docker mode: prompt-based restriction only.

import { createHash } from "crypto";
import path from "path";
import { homedir } from "os";
import { log } from "../system/logger/index.js";
import { readReferenceDirsJson, writeReferenceDirsJson, isExistingDirectory } from "../utils/files/reference-dirs-io.js";
import { hasStringProp, isRecord } from "../utils/types.js";
import { validateEntryList, type EntryListResult } from "../utils/validateEntryList.js";
import { isSensitiveMountPath } from "../utils/sensitiveMountPaths.js";
import { dockerMountArgs } from "../agent/dockerMount.js";
import type { Platform } from "../agent/config.js";

// ── Types ───────────────────────────────────────────────────────

export interface ReferenceDirEntry {
  /** Absolute host path to the directory. */
  hostPath: string;
  /** Short label shown in prompt and UI. */
  label: string;
}

// ── Constants ───────────────────────────────────────────────────

const MAX_ENTRIES = 20;
const MAX_LABEL_LENGTH = 100;
const CONTAINER_MOUNT_ROOT = "/mnt/readonly";

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE_G = /[\x00-\x1f]/g;

function expandHome(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function sanitizeLabel(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHAR_RE_G, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

function hasTraversalSegment(inputPath: string): boolean {
  return inputPath.split(path.sep).some((segment) => segment === "..");
}

function validateEntry(raw: unknown): ReferenceDirEntry | null {
  if (!isRecord(raw)) return null;

  const rawPath = typeof raw.hostPath === "string" ? raw.hostPath : "";
  if (!rawPath) return null;

  const expanded = expandHome(rawPath);

  // Must be absolute
  if (!path.isAbsolute(expanded)) return null;

  // Normalize to collapse . and // segments
  const absPath = path.resolve(expanded);

  // Reject actual ".." traversal segments (not substrings in filenames)
  if (hasTraversalSegment(expanded)) return null;

  // Block sensitive directories
  if (isSensitiveMountPath(absPath)) {
    log.warn("reference-dirs", "blocked sensitive path", { path: absPath });
    return null;
  }

  // Type-check like `hostPath` above rather than `String(...)`-ing: a
  // non-string `label` in the hand-edited config falls back to the basename
  // instead of labelling the directory "[object Object]".
  const label = sanitizeLabel(hasStringProp(raw, "label") ? raw.label : path.basename(absPath));

  return { hostPath: absPath, label };
}

// ── Load ────────────────────────────────────────────────────────

export function loadReferenceDirs(root?: string): ReferenceDirEntry[] {
  const parsed = readReferenceDirsJson(root);
  const seenLabels = new Set<string>();
  const entries = parsed
    .slice(0, MAX_ENTRIES)
    .map(validateEntry)
    .filter((entry): entry is ReferenceDirEntry => {
      if (!entry) return false;
      // Deduplicate labels — first entry wins
      if (seenLabels.has(entry.label)) return false;
      seenLabels.add(entry.label);
      return true;
    });

  const skipped = parsed.length - entries.length;
  if (skipped > 0) {
    log.warn("reference-dirs", "skipped invalid entries", { skipped });
  }
  return entries;
}

// ── Save ────────────────────────────────────────────────────────

export function saveReferenceDirs(entries: readonly ReferenceDirEntry[], root?: string): void {
  writeReferenceDirsJson(entries, root);
  invalidateCache();
}

// ── Validate input array (for API) ─────────────────────────────

export function validateReferenceDirs(raw: unknown): EntryListResult<ReferenceDirEntry> {
  const result = validateEntryList(raw, {
    maxEntries: MAX_ENTRIES,
    validateEntry,
    echoProp: "hostPath",
    describeInvalid: (hostPath) => `invalid or blocked path "${hostPath}"`,
  });
  if ("error" in result) return result;

  // Reject duplicate labels — @ref/<label> routing requires uniqueness
  const seenLabels = new Set<string>();
  for (const entry of result.entries) {
    if (seenLabels.has(entry.label)) {
      return { error: `duplicate label "${entry.label}"` };
    }
    seenLabels.add(entry.label);
  }
  return result;
}

// ── Cached loader (for system prompt + Docker mounts) ───────────

let cachedEntries: ReferenceDirEntry[] | null = null;

export function getCachedReferenceDirs(): readonly ReferenceDirEntry[] {
  if (cachedEntries === null) {
    cachedEntries = loadReferenceDirs();
  }
  return cachedEntries;
}

function invalidateCache(): void {
  cachedEntries = null;
}

// ── Docker mount args ───────────────────────────────────────────

/** Container path for a reference directory.
 *  Disambiguates with a short hash suffix to prevent collisions
 *  when different host paths share the same basename. */
// The readable half of the container name. Uniqueness comes from the hash, so
// reducing this to a safe set is lossless — and it keeps the host path's
// punctuation out of the mount TARGET, which used to disagree with the source
// because only the source was ever converted (#3191).
function safeBasename(hostPath: string): string {
  const reduced = [...path.basename(hostPath)].map((character) => (/[A-Za-z0-9._-]/.test(character) ? character : "_")).join("");
  return reduced.length > 0 ? reduced : "dir";
}

export function containerPath(entry: ReferenceDirEntry): string {
  const hash = createHash("sha256").update(entry.hostPath).digest("hex").slice(0, 8);
  return path.posix.join(CONTAINER_MOUNT_ROOT, `${safeBasename(entry.hostPath)}-${hash}`);
}

/**
 * Return Docker `-v` args for read-only reference directory mounts.
 * Skips entries whose host path doesn't exist.
 */
export interface ReferenceDirPlan {
  /** Docker mount arguments. Empty when not running under Docker. */
  args: string[];
  /** The entries the agent can actually reach — the only ones the prompt may
   *  name. */
  available: ReferenceDirEntry[];
  /** `missing` is ordinary — a directory the user removed. `unmountable` is a
   *  configuration problem that will never resolve on its own, so the two carry
   *  different log levels. */
  skipped: { entry: ReferenceDirEntry; reason: string; kind: "missing" | "unmountable" }[];
}

/**
 * Decide which reference directories the agent can actually reach.
 *
 * One decision, because two surfaces derive from the same entry list and used to
 * disagree: the mount args skipped an entry while the system prompt still told
 * the agent its container path was readable (#3194). That is worse than the
 * equivalent divergence on `/api/sandbox`, which misleads a human who can go and
 * look — this one misleads the agent, which acts on it.
 *
 * Pure apart from the existence check, and deliberately silent: the prompt is
 * rebuilt every turn, so the warning belongs to the spawn path alone.
 */
export function planReferenceDirs(entries: readonly ReferenceDirEntry[], useDocker: boolean, platform: Platform = process.platform): ReferenceDirPlan {
  const plan: ReferenceDirPlan = { args: [], available: [], skipped: [] };
  entries.forEach((entry) => {
    if (!isExistingDirectory(entry.hostPath)) {
      plan.skipped.push({ entry, reason: "not found or not a directory", kind: "missing" });
      return;
    }
    // Without Docker there is no mount: the agent reads the host path directly,
    // so existing is the whole of being reachable.
    if (!useDocker) {
      plan.available.push(entry);
      return;
    }
    const mount = dockerMountArgs({ hostPath: entry.hostPath, containerPath: containerPath(entry), readOnly: true }, platform);
    if (mount.kind === "args") {
      plan.args.push(...mount.args);
      plan.available.push(entry);
      return;
    }
    // A reference directory is an addition to the sandbox, not a prerequisite:
    // dropping this one leaves the others and the container working, where an
    // argument Docker refuses would stop the sandbox starting at all.
    plan.skipped.push({ entry, reason: mount.reason, kind: "unmountable" });
  });
  return plan;
}

export function referenceDirMountArgs(entries: readonly ReferenceDirEntry[], platform: Platform = process.platform): string[] {
  const plan = planReferenceDirs(entries, true, platform);
  plan.skipped.forEach(({ entry, reason, kind }) => {
    // A directory that went away is ordinary; a path no docker flag can carry is
    // a configuration problem that will not resolve until the user renames it,
    // and it kept its `warn` from before this was one code path.
    const write = kind === "unmountable" ? log.warn : log.info;
    write("reference-dirs", "skipped (not mounted, and not offered to the agent)", { path: entry.hostPath, reason });
  });
  return plan.args;
}

// ── System prompt snippet ───────────────────────────────────────

export function buildReferenceDirsPrompt(entries: readonly ReferenceDirEntry[], useDocker: boolean, platform: Platform = process.platform): string {
  // Only what is actually reachable. Naming a directory the agent cannot open
  // is worse than omitting it: it reads the empty container path and can
  // conclude the user's reference material is empty (#3194).
  const { available } = planReferenceDirs(entries, useDocker, platform);
  if (available.length === 0) return "";

  const lines = [
    "",
    "## Reference Directories (Read-Only)",
    "",
    "The user has configured external directories for reference.",
    "You may READ files in these directories but MUST NOT write, modify, or delete anything in them.",
    "",
  ];

  for (const entry of available) {
    const mountPath = useDocker ? containerPath(entry) : entry.hostPath;
    lines.push(`- \`${mountPath}\` — ${entry.label}`);
  }

  if (!useDocker) {
    lines.push("");
    lines.push(
      "**Important**: These directories are outside the workspace. " +
        "Do not create, edit, or delete files in them. " +
        "Only use read operations (read, glob, grep).",
    );
  }

  lines.push("");
  return lines.join("\n");
}
