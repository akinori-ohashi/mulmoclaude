// One webhook event → gate → (loading) → MulmoClaude → push. Every LINE call is injected.

import { formatAckReply, replyAfterProcessingIndicator, type BridgeClient, type ProcessingIndicatorOptions } from "@mulmobridge/client";
import { extractIncomingLineMessage, type IncomingLineMessage, type LineEvent } from "./parse.js";
import { loadingSenderFor } from "./loading.js";
import { shouldRespond } from "./groupGate.js";

export interface LineImage {
  bytes: Buffer;
  mimeType: string;
}

export interface LineDeliveryDeps {
  requireMention: boolean;
  send: BridgeClient["send"];
  push: (chatId: string, text: string) => Promise<void>;
  startLoading: (chatId: string) => Promise<void>;
  downloadImage: (messageId: string) => Promise<LineImage | null>;
  indicator: ProcessingIndicatorOptions;
  log: { log: (message: string) => void; error: (message: string) => void };
}

export async function deliverLineEvent(event: LineEvent, deps: LineDeliveryDeps): Promise<void> {
  const incoming = extractIncomingLineMessage(event);
  if (!incoming || !shouldRespond(incoming, deps.requireMention)) return;
  const sendLoading = loadingSenderFor(event.source, () => deps.startLoading(incoming.chatId));
  try {
    await replyAfterProcessingIndicator(
      sendLoading,
      { produce: () => produceReply(incoming, deps), post: (replyText) => deps.push(incoming.chatId, replyText) },
      deps.indicator,
    );
  } catch (err) {
    deps.log.error(`[line] message handling failed: ${err}`);
  }
}

async function produceReply(incoming: IncomingLineMessage, deps: LineDeliveryDeps): Promise<string> {
  if (incoming.kind === "text") {
    deps.log.log(`[line] message ${incoming.chatType}=${incoming.chatId} len=${incoming.text.length}`);
    return formatAckReply(await deps.send(incoming.chatId, incoming.text));
  }
  deps.log.log(`[line] image ${incoming.chatType}=${incoming.chatId} messageId=${incoming.imageMessageId}`);
  const image = await deps.downloadImage(incoming.imageMessageId);
  if (!image) return "Sorry, I couldn't fetch that image.";
  // chat-service's `parseMessagePayload` rejects empty `text`
  // (`text is required`) so attachment-only messages need a
  // placeholder body. Mirror the Telegram convention (see
  // `packages/bridges/telegram/src/router.ts`) — an instructive
  // prompt rather than a caption, so the agent treats the
  // attachment as the subject and produces a useful response.
  // The post-save EXIF hook (#1222 PR-A) writes a sidecar if
  // GPS data is present. (Codex review on PR #1255 / #1263.)
  const attachments = [{ mimeType: image.mimeType, data: image.bytes.toString("base64") }];
  const placeholderText = "Describe / analyze this file.";
  return formatAckReply(await deps.send(incoming.chatId, placeholderText, attachments));
}
