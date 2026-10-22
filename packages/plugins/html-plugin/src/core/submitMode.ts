import { isRecord } from "@mulmoclaude/common";
import { isHtmlArtifactPath } from "./paths";

export const DIRECT_SUBMIT = "direct";

export type SubmitMode = typeof DIRECT_SUBMIT;

export type SubmitDelivery = "direct" | "confirm";

export const DIRECT_SUBMIT_MIN_INTERVAL_MS = 3_000;

export const SUBMIT_KEY_PARAM = "mulmo-submit-key";

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

// Only a page the agent writes now (`html`) may skip the confirmation bar. A `path` names a
// file that already exists — a cloned repo, a download, a build report — whose script nobody
// here wrote, and letting it type into the conversation as the user is the risk the bar exists for.
export function submitModeFor(args: unknown): SubmitMode | undefined {
  if (!isRecord(args) || args.submit !== DIRECT_SUBMIT) return undefined;
  if (!nonEmptyString(args.html) || nonEmptyString(args.path)) return undefined;
  return DIRECT_SUBMIT;
}

// The View's half of the same rule. `data` is ordinary result data — it is persisted, restored and
// can be posted to a host by any local process — so the flag alone is not trusted: it counts only on
// a page this tool wrote, under artifacts/html/, never on a result that points at some other file.
export function submitModeOfResult(data: unknown): SubmitMode | undefined {
  if (!isRecord(data) || data.submit !== DIRECT_SUBMIT) return undefined;
  if (typeof data.filePath !== "string" || !isHtmlArtifactPath(data.filePath)) return undefined;
  return DIRECT_SUBMIT;
}

// The key rides in the fragment of the URL the View loads, so only the document that URL produced
// can read it. A link or script that moves the frame to another document drops the fragment, and
// that document — which may post before its load event fires — cannot present the key, unless the
// direct page hands it on (window.name, a URL it builds). That is allowed: the page could send anything itself.
export function withSubmitKey(src: string, key: string): string {
  const param = `${SUBMIT_KEY_PARAM}=${encodeURIComponent(key)}`;
  const hashAt = src.indexOf("#");
  if (hashAt < 0) return `${src}#${param}`;
  const fragment = src.slice(hashAt + 1);
  return `${src.slice(0, hashAt)}#${fragment ? `${fragment}&` : ""}${param}`;
}

export interface DirectSubmitCheck {
  mode: SubmitMode | undefined;
  expectedKey: string | undefined;
  givenKey: string | undefined;
  lastDirectAtMs: number | null;
  nowMs: number;
}

// A direct send needs the mode, the key of this frame's document, and the interval since the last
// direct send; anything else goes to the bar, so a page that posts in a loop fills one editable bar
// instead of the conversation.
export function deliveryFor({ mode, expectedKey, givenKey, lastDirectAtMs, nowMs }: DirectSubmitCheck): SubmitDelivery {
  if (mode !== DIRECT_SUBMIT) return "confirm";
  if (!expectedKey || givenKey !== expectedKey) return "confirm";
  if (lastDirectAtMs === null) return "direct";
  const elapsedMs = nowMs - lastDirectAtMs;
  return elapsedMs >= DIRECT_SUBMIT_MIN_INTERVAL_MS ? "direct" : "confirm";
}
