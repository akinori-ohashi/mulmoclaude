// A tool definition may split its LLM instructions in two: `promptCompact`,
// injected inline, and `promptFiles`, reference files the host writes to disk
// for the agent to Read. `prompt` stays the full text, so a host that knows
// nothing of the split keeps working. Pure — the file writing is `./sync`.

import { isRecord } from "@mulmoclaude/common";

/** Replaced in `promptCompact` with the directory the agent reads the files
 *  from — a path only the host knows (cwd-relative in MulmoClaude, absolute in
 *  MulmoTerminal). */
export const PROMPT_FILES_DIR_PLACEHOLDER = "{{promptFilesDir}}";

export interface PromptSplit {
  compact: string;
  /** file name (may contain `/`) → file content */
  files: Readonly<Record<string, string>>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A file name a plugin may declare: relative, `/`-separated, every segment a
 *  plain name — no `..`, no absolute path, no backslash, no hidden file. */
export function isSafePromptFileName(name: string): boolean {
  if (name.length === 0) return false;
  return name.split("/").every((segment) => SAFE_SEGMENT.test(segment));
}

/** Where one package's files go, relative to the host's root: the
 *  `node_modules` layout (`@scope/name`, or `name`), so two packages can never
 *  share a directory. Null for a name that could escape it. */
export function promptFilesSubdir(packageName: string): string | null {
  const segments = packageName.split("/");
  if (segments.length === 1) return SAFE_SEGMENT.test(packageName) ? packageName : null;
  const [scope = "", name = ""] = segments;
  const isScoped = segments.length === 2 && scope.startsWith("@") && SAFE_SEGMENT.test(scope.slice(1)) && SAFE_SEGMENT.test(name);
  return isScoped ? packageName : null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/** Characters that end a file reference in prose: whitespace and the
 *  punctuation that wraps or follows a path (`…/guide.md`, (…/guide.md)). */
const REFERENCE_TERMINATORS = new Set([" ", "\t", "\n", "\r", "`", "'", '"', ")", "]", ">", ",", ";", ":", "!", "?", "。", "、", "）", "」"]);

function trimTrailingDots(token: string): string {
  let end = token.length;
  while (end > 0 && token[end - 1] === ".") end -= 1;
  return token.slice(0, end);
}

/** The text after one placeholder up to where the reference ends. */
function referenceToken(afterPlaceholder: string): string {
  const chars = [...afterPlaceholder];
  const end = chars.findIndex((char) => REFERENCE_TERMINATORS.has(char));
  return trimTrailingDots(chars.slice(0, end === -1 ? chars.length : end).join(""));
}

/** The files the compact text points at (`{{promptFilesDir}}/<name>`),
 *  sentence-ending dots dropped. A bare `{{promptFilesDir}}` names the
 *  directory itself and contributes nothing. Null when a reference is not a
 *  safe file name — the agent would be sent to a path that cannot exist. */
export function referencedPromptFiles(compact: string): string[] | null {
  const references = compact
    .split(PROMPT_FILES_DIR_PLACEHOLDER)
    .slice(1)
    .filter((afterPlaceholder) => afterPlaceholder.startsWith("/"))
    .map((afterPlaceholder) => referenceToken(afterPlaceholder.slice(1)));
  return references.every(isSafePromptFileName) ? references : null;
}

/** The split a definition declares, or null when it declares none — or one
 *  that would leave the agent pointed at a missing file: no files, an unsafe
 *  name, or a reference in the compact text to a file it does not declare.
 *  The host then injects the full `prompt`. */
export function readPromptSplit(definition: unknown): PromptSplit | null {
  if (!isRecord(definition)) return null;
  const { promptCompact, promptFiles } = definition;
  if (typeof promptCompact !== "string" || promptCompact.trim().length === 0) return null;
  if (!isStringRecord(promptFiles)) return null;
  const names = Object.keys(promptFiles);
  if (names.length === 0 || !names.every(isSafePromptFileName)) return null;
  const references = referencedPromptFiles(promptCompact);
  if (!references?.every((name) => Object.hasOwn(promptFiles, name))) return null;
  return { compact: promptCompact, files: promptFiles };
}

/** The text to inject for one tool. `agentFilesDir` is where the agent can
 *  read this package's files, or null when they were not written — then the
 *  full `prompt` is the only safe choice. */
export function renderToolPrompt(definition: unknown, agentFilesDir: string | null): string | undefined {
  const fullPrompt = isRecord(definition) && typeof definition.prompt === "string" ? definition.prompt : undefined;
  const split = readPromptSplit(definition);
  if (!split || agentFilesDir === null) return fullPrompt;
  return split.compact.split(PROMPT_FILES_DIR_PLACEHOLDER).join(agentFilesDir);
}
