import { isRecord } from "@mulmoclaude/common";

export const DIRECT_SUBMIT = "direct";

export type SubmitMode = typeof DIRECT_SUBMIT;

export type SubmitDelivery = "direct" | "confirm";

export const DIRECT_SUBMIT_MIN_INTERVAL_MS = 3_000;

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

// Only a page the agent writes now (`html`) may skip the confirmation bar. A `path` names a
// file that already exists — a cloned repo, a download, a build report — whose script nobody
// here wrote, and letting it type into the conversation as the user is the risk the bar exists for.
export function submitModeFor(args: unknown): SubmitMode | undefined {
  if (!isRecord(args) || args.submit !== DIRECT_SUBMIT) return undefined;
  if (!nonEmptyString(args.html) || nonEmptyString(args.path)) return undefined;
  return DIRECT_SUBMIT;
}

// A direct send is allowed once per interval; anything sooner goes to the bar, so a page that
// posts in a loop fills one editable bar instead of the conversation.
export function deliveryFor(mode: SubmitMode | undefined, lastDirectAtMs: number | null, nowMs: number): SubmitDelivery {
  if (mode !== DIRECT_SUBMIT) return "confirm";
  if (lastDirectAtMs === null) return "direct";
  const elapsedMs = nowMs - lastDirectAtMs;
  return elapsedMs >= DIRECT_SUBMIT_MIN_INTERVAL_MS ? "direct" : "confirm";
}
