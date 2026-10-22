import { isRecord } from "@mulmoclaude/common";

export const SUBMIT_MESSAGE_TYPE = "mulmo-html-submit";

export const MAX_SUBMIT_TEXT_CHARS = 20_000;

export type SubmitRead = { kind: "ignored" } | { kind: "tooLong" } | { kind: "text"; text: string };

export interface SubmitEventLike {
  source: unknown;
  data: unknown;
}

const IGNORED: SubmitRead = { kind: "ignored" };

// The frame is opaque-origin, so `event.origin` is "null" for every presented page:
// only `event.source` can tell this View's iframe from another one on the same screen.
export function readSubmitMessage(event: SubmitEventLike, frameWindow: unknown): SubmitRead {
  if (frameWindow === null || frameWindow === undefined || event.source !== frameWindow) return IGNORED;
  const { data } = event;
  if (!isRecord(data) || data.type !== SUBMIT_MESSAGE_TYPE || typeof data.text !== "string") return IGNORED;
  if (data.text.length > MAX_SUBMIT_TEXT_CHARS) return { kind: "tooLong" };
  if (data.text.trim() === "") return IGNORED;
  return { kind: "text", text: data.text };
}
