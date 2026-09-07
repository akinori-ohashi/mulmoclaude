// Pure rules for the media on an incoming status (#2952). Kept out of
// `index.ts` because that module reads env and calls `process.exit` at
// import time, so it cannot be pulled into a test.

import { isRecord } from "@mulmoclaude/common";

/** A media entry the bridge forwards. Mastodon also carries `video`,
 *  `gifv`, `audio` and `unknown` types; those are left alone. */
export interface ImageMedia {
  url: string;
}

/** chat-service rejects an empty `text`, so an attachment-only status
 *  needs a body. Same wording as the Telegram, LINE and Discord
 *  bridges — an instruction, so the agent treats the image as the
 *  subject rather than looking for a caption. */
const ATTACHMENT_ONLY_PROMPT = "Describe / analyze this file.";
/** chat-service's `parseAttachments` drops whatever pushes a message past
 *  this much base64, silently, and the socket frame is capped just above
 *  it. Mirrored here so the bridge can say what it left out instead of
 *  letting the message be truncated or the connection closed. */
export const MAX_TOTAL_BASE64_CHARS = 20 * 1024 * 1024;

/** The image entries of a status' `media_attachments`, in order. */
export function imageMediaEntries(media: unknown): ImageMedia[] {
  if (!Array.isArray(media)) return [];
  return media.flatMap((item) => (isRecord(item) && item.type === "image" && typeof item.url === "string" ? [{ url: item.url }] : []));
}

/** False when there is nothing to relay at all — no caption, and no
 *  images to stand in for one. */
export function hasRelayableContent(text: string, mediaCount: number): boolean {
  return text.trim().length > 0 || mediaCount > 0;
}

/** True when a status that DID carry images ends up with none of them
 *  and no caption to fall back on. Only meaningful once
 *  `hasRelayableContent` has already passed. */
export function isLostImagesOnly(text: string, attachmentCount: number): boolean {
  return text.trim().length === 0 && attachmentCount === 0;
}

/** The body sent to MulmoClaude: a placeholder when the sender posted
 *  only images, plus a note when some of them were lost. */
export function resolveMessageText(text: string, dropped: number): string {
  const trimmed = text.trim();
  const body = trimmed.length > 0 ? trimmed : ATTACHMENT_ONLY_PROMPT;
  if (dropped <= 0) return body;
  const plural = dropped === 1 ? "file" : "files";
  return `${body}\n\n(note: ${dropped} attached ${plural} could not be downloaded)`;
}

/** The images that fit in one message, in order. Mastodon does not state
 *  a media entry's size up front, so the budget can only be spent once
 *  the bytes are in hand. An image that does not fit is skipped rather
 *  than ending the loop: a smaller one after it may still fit. */
export function fitBudget<T extends { data: string }>(attachments: T[]): T[] {
  const kept: T[] = [];
  let remaining = MAX_TOTAL_BASE64_CHARS;
  attachments.forEach((attachment) => {
    if (attachment.data.length > remaining) return;
    remaining -= attachment.data.length;
    kept.push(attachment);
  });
  return kept;
}
