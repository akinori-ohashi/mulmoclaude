// Secrets the user types into Settings, kept outside the workspace.
//
// `~/.mulmoclaude/secrets/<KEY>`, one file per key, 0600 on POSIX (#871). NOT under
// `~/mulmoclaude`: that workspace is the agent's data space — "the workspace
// is the database" — and a credential there is readable by everything the
// agent does. Not `.env` in a launch directory either, which is the thing
// this exists to replace: an icon launch has no launch directory, so the
// documented way to supply a key asked the user to find a place that does
// not exist (#2626).
//
// The stored value is applied to `process.env` at boot rather than read at
// use time, because the server is not the only consumer: the agent shells
// out to `mulmocast` for audio and video, and a child process receives a
// key exactly one way — through the environment it inherits. Reading the
// file only where the server calls Gemini would make image generation work
// and video generation fail, which is a worse bug than the one being fixed.

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "../utils/files/atomic.js";
import { hasControlCharacter } from "../utils/text.js";

/** Keys Settings may write. A fixed list, never a request field — the file
 *  path is built from it, so an open set would be a path-traversal hole. */
export const SECRET_KEYS = ["GEMINI_API_KEY"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export function isSecretKey(value: unknown): value is SecretKey {
  return typeof value === "string" && SECRET_KEYS.some((key) => key === value);
}

/** Owner-only, on the file and the directory holding it.
 *
 *  A POSIX guarantee, not a universal one: Windows carries no POSIX mode, so
 *  Node applies only the read-only bit and these are ignored there. What
 *  protects the file on Windows is where it sits — under the user's own
 *  profile, whose ACL it inherits — which is why `secretsDir` is anchored to
 *  the home directory rather than to a mode (#3251). */
const SECRET_FILE_MODE = 0o600;
const SECRET_DIR_MODE = 0o700;

/** An API key is a token, not a document. The cap is generous enough for
 *  any provider's key and small enough that a mis-paste (a whole file, a
 *  log dump) is rejected rather than written into every child process's
 *  environment. */
export const MAX_SECRET_LENGTH = 4096;

export function secretsDir(home: string = homedir()): string {
  return path.join(home, ".mulmoclaude", "secrets");
}

/** The file name for a key, written out as a literal here.
 *
 *  Deliberately re-derived instead of passing the key through: it arrives on a
 *  request, and "`isSecretKey` narrowed it to a one-member union" is a fact the
 *  type checker knows and a dataflow scanner does not — CodeQL reported
 *  `js/path-injection` on the previous form. Returning a literal means no
 *  request string reaches `path.join` at all, and adding a key becomes a
 *  compile error here rather than a new way to build a path. Same shape as
 *  `catalogDirForSource` in `server/workspace/skills/catalog.ts`. */
function secretFileName(key: SecretKey): string {
  if (key === "GEMINI_API_KEY") return "GEMINI_API_KEY";
  const exhaustive: never = key;
  throw new Error(`unknown secret key: ${String(exhaustive)}`);
}

export function secretFilePath(key: SecretKey, home: string = homedir()): string {
  return path.join(secretsDir(home), secretFileName(key));
}

/** Why a value was refused. The UI turns this into a message, so the
 *  reason is a token rather than prose. */
export type SecretRejection = "empty" | "too-long" | "control-characters";

export type SecretValidation = { ok: true; value: string } | { ok: false; reason: SecretRejection };

/** Trim and check. Pure.
 *
 *  Control characters are refused rather than stripped: this value goes
 *  into `process.env` and is inherited by every child process, where a
 *  newline is not a cosmetic problem — anything that serialises the
 *  environment (a `.env` dump, a shell export, a log line) would read the
 *  second line as something of its own. A pasted key with a stray newline
 *  is a mis-paste worth telling the user about, not one to silently fix. */
export function validateSecretValue(raw: string): SecretValidation {
  const value = raw.trim();
  if (value === "") return { ok: false, reason: "empty" };
  if (value.length > MAX_SECRET_LENGTH) return { ok: false, reason: "too-long" };
  if (hasControlCharacter(value)) return { ok: false, reason: "control-characters" };
  return { ok: true, value };
}

/** The stored value, or undefined when there is none worth using.
 *
 *  A file the user hand-edited into something unusable is treated as
 *  absent: the alternative is poisoning `process.env` for every child
 *  process with a value the UI already refuses to accept. Any read error
 *  (missing, unreadable, a directory) is "no stored secret" — this runs
 *  before the logger at boot, so there is nowhere to complain to. */
export function readStoredSecret(key: SecretKey, home: string = homedir()): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(secretFilePath(key, home), "utf8");
  } catch {
    return undefined;
  }
  const validation = validateSecretValue(contents);
  return validation.ok ? validation.value : undefined;
}

export function writeStoredSecret(key: SecretKey, value: string, home: string = homedir()): void {
  mkdirSync(secretsDir(home), { recursive: true, mode: SECRET_DIR_MODE });
  writeFileAtomicSync(secretFilePath(key, home), value, { mode: SECRET_FILE_MODE });
}

/** Remove the stored value. Absent is success — the caller asked for the
 *  key to be gone, and it is. */
export function deleteStoredSecret(key: SecretKey, home: string = homedir()): void {
  rmSync(secretFilePath(key, home), { force: true });
}

/** Where the value in effect came from. `gui` beats `env` on purpose: a
 *  stale `export` in a shell profile silently winning over what the user
 *  just typed is the trap this whole feature exists to close (#2604), and
 *  it is invisible precisely because nothing fails. */
export type SecretSource = "gui" | "env" | "none";

export function secretSource(key: SecretKey, env: Record<string, string | undefined>, home: string = homedir()): SecretSource {
  if (readStoredSecret(key, home) !== undefined) return "gui";
  const fromEnv = env[key];
  return fromEnv !== undefined && fromEnv !== "" ? "env" : "none";
}

export interface AppliedSecrets {
  /** Keys taken from the store. */
  applied: SecretKey[];
  /** Keys where the store replaced a value the shell (or a `.env`) had
   *  already set. Names only — the caller logs these. */
  overrode: SecretKey[];
  /** The values that were replaced, so clearing the stored secret can hand
   *  the key back to the shell instead of leaving it unset until a restart.
   *  Without this, "GUI when set, else the environment" would hold on the
   *  way in and not on the way out. */
  replaced: Partial<Record<SecretKey, string>>;
}

/** Copy stored secrets onto `target`, overriding what is there.
 *
 *  Must run before anything reads the environment at module scope — see
 *  the ordering note in `loadEnv.ts`. */
export function applyStoredSecrets(target: Record<string, string | undefined>, home: string = homedir()): AppliedSecrets {
  const result: AppliedSecrets = { applied: [], overrode: [], replaced: {} };
  for (const key of SECRET_KEYS) {
    const stored = readStoredSecret(key, home);
    if (stored === undefined) continue;
    const previous = target[key];
    if (previous !== undefined && previous !== "") {
      result.replaced[key] = previous;
      if (previous !== stored) result.overrode.push(key);
    }
    target[key] = stored;
    result.applied.push(key);
  }
  return result;
}
