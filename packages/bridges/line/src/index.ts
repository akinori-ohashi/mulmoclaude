#!/usr/bin/env node
// @mulmobridge/line — LINE bridge for MulmoClaude.
//
// Runs a small HTTP server to receive LINE webhook events.
// Requires a public URL (use ngrok for development).
//
// Required env vars:
//   LINE_CHANNEL_SECRET      — Channel secret from LINE Developers Console
//   LINE_CHANNEL_ACCESS_TOKEN — Channel access token (long-lived)
//
// Optional:
//   LINE_BRIDGE_PORT          — Webhook listener port (default: 3002)
//   MULMOCLAUDE_API_URL       — default: the port in <workspace>/.server-port.
//                               With none published the client waits (#3078)
//   MULMOCLAUDE_AUTH_TOKEN    — bearer token
//   LINE_BRIDGE_GROUP_REQUIRE_MENTION — "1" (default) answers in groups / rooms only
//                               when the bot is mentioned; "0" answers every message

import "dotenv/config";
import type { Request, Response } from "express";
import { createBridgeClient, chunkText, installProcessGuards } from "@mulmobridge/client";
import { createWebhookApp, createWebhookRateLimit, verifyHmacSignature, listenWebhook } from "@mulmobridge/webhook-runtime";
import { parseLineWebhookBody } from "./parse.js";
import { LINE_LOADING_REFRESH_MS, startLineLoading } from "./loading.js";
import { parseRequireMention } from "./groupGate.js";
import { deliverLineEvent, type LineDeliveryDeps, type LineImage } from "./deliver.js";

const TRANSPORT_ID = "line";

installProcessGuards({ name: TRANSPORT_ID });

function readRequiredEnv(): { channelSecret: string; channelAccessToken: string } {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !channelAccessToken) {
    console.error("LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN are required.\nSee README for setup instructions.");
    process.exit(1);
  }
  return { channelSecret, channelAccessToken };
}
const { channelSecret, channelAccessToken } = readRequiredEnv();

// The explicit `T` return annotation is what lets TS see `process.exit`'s
// `never` and accept the catch branch as non-returning.
function parseEnvOrExit<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    console.error(`[line] ${err instanceof Error ? err.message : String(err)}`);
  }
  return process.exit(1);
}

const requireMention = parseEnvOrExit(() => parseRequireMention(process.env.LINE_BRIDGE_GROUP_REQUIRE_MENTION));

const client = createBridgeClient({ transportId: TRANSPORT_ID });

client.onPush((pushEvent) => {
  pushMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[line] push send failed: ${err}`));
});

// ── LINE API helpers ────────────────────────────────────────────

/** Download an image attached to an inbound LINE message. Returns
 *  the bytes + Content-Type so the caller can build an Attachment
 *  envelope for the chat-service socket. Returns null when the
 *  fetch fails (network error, 4xx, …) — caller logs and skips. */
async function downloadLineImage(messageId: string): Promise<LineImage | null> {
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[line] downloadLineImage failed: ${res.status}`);
      return null;
    }
    // LINE returns image/jpeg by default but the Data API also
    // serves the original sender format (PNG, GIF, …). Trust the
    // Content-Type header so the photo-EXIF hook (#1222 PR-A) can
    // tell HEIC apart from JPEG and surface the right sidecar.
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();
    return { bytes: Buffer.from(arrayBuffer), mimeType };
  } catch (err) {
    console.error(`[line] downloadLineImage network error: ${err}`);
    return null;
  }
}

/** `to` is a userId, groupId or roomId — LINE's push accepts all three. */
async function pushMessage(chatId: string, text: string): Promise<void> {
  const messages = chunkText(text, 5000).map((messageText) => ({
    type: "text",
    text: messageText,
  }));
  // LINE allows max 5 messages per push
  for (let i = 0; i < messages.length; i += 5) {
    try {
      const requestBody = {
        to: chatId,
        messages: messages.slice(i, i + 5),
      };
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[line] pushMessage failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[line] pushMessage network error: ${err}`);
    }
  }
}

const deliveryDeps: LineDeliveryDeps = {
  requireMention,
  send: (chatId, text, attachments) => client.send(chatId, text, attachments),
  push: pushMessage,
  startLoading: (chatId) => startLineLoading(fetch, channelAccessToken, chatId),
  downloadImage: downloadLineImage,
  indicator: { refreshMs: LINE_LOADING_REFRESH_MS, label: TRANSPORT_ID, log: console },
  log: console,
};

// ── Webhook server ──────────────────────────────────────────────

const app = createWebhookApp();
const webhookRateLimit = createWebhookRateLimit();

app.post("/webhook", webhookRateLimit, async (req: Request, res: Response) => {
  const signature = typeof req.headers["x-line-signature"] === "string" ? req.headers["x-line-signature"] : "";
  const bodyStr = typeof req.body === "string" ? req.body : "";

  if (!signature || !verifyHmacSignature(bodyStr, signature, channelSecret)) {
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("OK");

  const body = parseLineWebhookBody(bodyStr);
  if (!body) {
    console.error("[line] malformed JSON in webhook body");
    return;
  }

  for (const event of body.events) {
    await deliverLineEvent(event, deliveryDeps);
  }
});

listenWebhook(app, { envVar: "LINE_BRIDGE_PORT", fallback: 3002 }, (port) => {
  console.log("MulmoClaude LINE bridge");
  console.log(`Webhook listening on http://localhost:${port}/webhook`);
  console.log("Set your LINE webhook URL to: <public-url>/webhook");
});
