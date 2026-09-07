// Attachment handling for the Discord bridge (#2939). Kept out of
// `index.ts` so the download rules can be exercised with a stubbed
// fetch — no gateway, no CDN, no env reads.

import { mimeFromExtension } from "@mulmobridge/client";
import type { Attachment } from "@mulmobridge/protocol";

/** The fields of discord.js' `Attachment` this bridge reads. */
export interface DiscordAttachmentLike {
  url: string;
  name: string;
  size: number;
  contentType: string | null;
}

export interface CollectedAttachments {
  attachments: Attachment[];
  /** Attachments on the message that could not be forwarded — over the
   *  cap, past the count limit, or the download failed. */
  dropped: number;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface DownloadDeps {
  fetchFn: FetchFn;
  log?: { warn: (message: string) => void };
}

// Discord serves message attachments from its own CDN. A URL pointing
// anywhere else means the payload was tampered with, so it is refused
// rather than turned into a server-side request forgery primitive.
const ALLOWED_HOST_SUFFIXES = [".discordapp.com", ".discordapp.net", ".discord.com"];

/** Per-file byte cap. chat-service's own gate is 20 MB of base64
 *  across the whole message (~15 MB raw), so one file stays well
 *  under it. Discord's free-tier upload limit is 10 MB. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** chat-service's `parseAttachments` drops everything past the tenth
 *  entry, so downloading more than that is wasted bandwidth. */
export const MAX_ATTACHMENT_COUNT = 10;
/** …and it drops whatever pushes the message past this much base64,
 *  silently. Mirrored here so the bridge can say what it left out. */
export const MAX_TOTAL_BASE64_CHARS = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const FALLBACK_MIME = "application/octet-stream";
/** chat-service rejects an empty `text`, so an attachment-only message
 *  needs a body. Same wording as the Telegram and LINE bridges — an
 *  instruction, so the agent treats the file as the subject. */
const ATTACHMENT_ONLY_PROMPT = "Describe / analyze this file.";
const LOG_LABEL_MAX_CHARS = 100;
const UNPRINTABLE_RE = /[^\p{L}\p{N}\p{P}\p{S}\p{Zs}]/gu;

const defaultLog = { warn: (message: string) => console.warn(message) };

export function isDiscordCdnUrl(raw: string): boolean {
  const url = parseUrl(raw);
  if (url === null || url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Discord's `contentType` carries parameters (`text/plain; charset=utf-8`)
 *  and is null for types it cannot sniff, so fall back to the filename. */
export function resolveMimeType(file: DiscordAttachmentLike): string {
  const declared = (file.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (declared.length > 0) return declared;
  const dot = file.name.lastIndexOf(".");
  if (dot < 0 || dot === file.name.length - 1) return FALLBACK_MIME;
  return mimeFromExtension(file.name.slice(dot + 1), FALLBACK_MIME);
}

/** Why this file cannot be fetched at all, or null when it may be. */
function refuseReason(file: DiscordAttachmentLike): string | null {
  if (!isDiscordCdnUrl(file.url)) return "not served from a Discord CDN host";
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.size} bytes is over the ${MAX_ATTACHMENT_BYTES} byte cap`;
  return null;
}

/** A filename reaches the log verbatim; control characters in it would
 *  forge log lines, so keep only printable categories. */
function logLabel(name: string): string {
  return name.replace(UNPRINTABLE_RE, " ").slice(0, LOG_LABEL_MAX_CHARS);
}

async function drainCapped(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

/** Read at most `maxBytes`, aborting mid-stream rather than after the
 *  fact — `arrayBuffer()` would have already materialised the body. */
async function readCappedBody(res: Response, maxBytes: number): Promise<Buffer | null> {
  const { body } = res;
  if (body === null) return null;
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Returning without draining would leave the connection open until
    // the socket times out, one leak per oversized attachment.
    await body.cancel();
    return null;
  }
  return drainCapped(body.getReader(), maxBytes);
}

export async function downloadAttachment(file: DiscordAttachmentLike, deps: DownloadDeps): Promise<Attachment | null> {
  const log = deps.log ?? defaultLog;
  const refused = refuseReason(file);
  if (refused !== null) {
    log.warn(`[discord] attachment skipped: ${logLabel(file.name)} — ${refused}`);
    return null;
  }
  try {
    const res = await deps.fetchFn(file.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
    if (!res.ok) {
      log.warn(`[discord] attachment fetch failed: ${logLabel(file.name)} — HTTP ${res.status}`);
      return null;
    }
    const bytes = await readCappedBody(res, MAX_ATTACHMENT_BYTES);
    if (bytes === null) {
      log.warn(`[discord] attachment skipped: ${logLabel(file.name)} — body over the ${MAX_ATTACHMENT_BYTES} byte cap`);
      return null;
    }
    return { mimeType: resolveMimeType(file), data: bytes.toString("base64"), filename: file.name };
  } catch (err) {
    log.warn(`[discord] attachment download failed: ${logLabel(file.name)} — ${err}`);
    return null;
  }
}

/** Length of the base64 a payload of `byteLength` bytes encodes to —
 *  4 characters per 3-byte group, rounded up. That string length, not
 *  the raw size, is what the server's per-message budget counts. */
export function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

/** Spend the server's per-message budget before anything is downloaded —
 *  Discord states each file's size up front. Without this the bridge
 *  would ship attachments that `parseAttachments` silently truncates,
 *  so the user is never told a file went missing. A file that does not
 *  fit is skipped rather than ending the loop: a smaller one after it
 *  may still fit. */
function withinBudget(files: DiscordAttachmentLike[]): { considered: DiscordAttachmentLike[]; skipped: DiscordAttachmentLike[] } {
  const considered: DiscordAttachmentLike[] = [];
  const skipped: DiscordAttachmentLike[] = [];
  let remaining = MAX_TOTAL_BASE64_CHARS;
  files.forEach((file) => {
    const cost = base64Length(file.size);
    if (considered.length >= MAX_ATTACHMENT_COUNT || cost > remaining) {
      skipped.push(file);
      return;
    }
    remaining -= cost;
    considered.push(file);
  });
  return { considered, skipped };
}

/** Re-check the budget against the bytes actually in hand. `withinBudget`
 *  spends it on Discord's declared sizes; this is what makes the guarantee
 *  hold if a declared size ever under-reports, since the server would
 *  otherwise truncate the overflow without telling anyone. */
function fitBudget(attachments: Attachment[]): Attachment[] {
  const kept: Attachment[] = [];
  let remaining = MAX_TOTAL_BASE64_CHARS;
  attachments.forEach((attachment) => {
    const cost = attachment.data?.length ?? 0;
    if (cost > remaining) return;
    remaining -= cost;
    kept.push(attachment);
  });
  return kept;
}

export async function collectAttachments(files: DiscordAttachmentLike[], deps: DownloadDeps): Promise<CollectedAttachments> {
  const log = deps.log ?? defaultLog;
  const { considered, skipped } = withinBudget(files);
  skipped.forEach((file) => log.warn(`[discord] attachment skipped: ${logLabel(file.name)} — over what one message may carry`));
  const results = await Promise.all(considered.map((file) => downloadAttachment(file, deps)));
  const attachments = fitBudget(results.filter((entry): entry is Attachment => entry !== null));
  return { attachments, dropped: files.length - attachments.length };
}

/** The body sent to MulmoClaude: a placeholder when the user posted
 *  only files, plus a note when some of them were lost. */
export function resolveMessageText(text: string, dropped: number): string {
  const trimmed = text.trim();
  const body = trimmed.length > 0 ? trimmed : ATTACHMENT_ONLY_PROMPT;
  if (dropped <= 0) return body;
  const plural = dropped === 1 ? "file" : "files";
  return `${body}\n\n(note: ${dropped} attached ${plural} could not be downloaded)`;
}
