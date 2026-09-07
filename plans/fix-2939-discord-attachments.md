# Discord ブリッジが添付を渡していない (#2939)

**Status**: implementing
**Tracks**: #2939
**Last updated**: 2026-08-25

## 問題

`packages/bridges/discord/src/index.ts` の `onMessageCreate` は `msg.attachments`
を一度も読んでいない。加えて `if (!text) return;` があるため、画像だけの投稿は
本文が空の時点で捨てられる。結果として Discord に画像を貼っても何も起きない。

`@mulmobridge/client` の `send(externalChatId, text, attachments)` も
`@mulmobridge/protocol` の `Attachment` も #382 で用意済みで、Telegram / LINE /
Mastodon は既にこの経路に繋がっている。Discord だけが繋がっていない。

## 制約（実装前に確認した事実）

- `packages/chat-service/src/socket.ts` の `parseMessagePayload` は **空 text を拒否**
  する (`text is required`)。添付のみのメッセージにはプレースホルダ本文が要る。
  LINE / Telegram は `"Describe / analyze this file."` を使っている → 揃える。
- 同ファイルのサーバ側上限: `MAX_ATTACHMENT_COUNT = 10`、
  `MAX_ATTACHMENT_TOTAL_BYTES = 20MB`（base64 長）。ブリッジ側はこれ以下に収める。
- `server/agent/config.ts` の `buildUserMessageLine` は image / PDF をネイティブ
  ブロック、text / docx / xlsx / pptx を変換、それ以外は warn してスキップする。
  つまり **ブリッジ側で MIME を絞る必要はない**（Telegram の document 経路と同じ）。
- discord.js の `Attachment` は `url` / `name` / `size` / `contentType` を持つ。
  添付は MESSAGE_CONTENT 特権インテント配下 — ブリッジは既に要求済み。

## 方針

1. 新規 `packages/bridges/discord/src/attachments.ts`（純粋関数 + fetch を DI）
   - `isDiscordCdnUrl(url)` — https かつ discord 系ホストのみ許可（SSRF ガード）
   - `resolveMimeType(att)` — `contentType` のパラメータ除去 → 拡張子推定
     (`mimeFromExtension` を再利用) → `application/octet-stream`
   - `readCappedBody(res, maxBytes)` — 宣言サイズ + ストリーム両方で打ち切り
   - `downloadAttachment` / `collectAttachments` — 件数上限・サイズ上限・
     失敗件数を返す
   - `resolveMessageText(text, dropped)` — 空本文のプレースホルダ、落とした添付の注記
2. `index.ts` を繋ぎ替える
   - allowlist チェックを **fetch より前** に（拒否チャンネルで通信しない）
   - `text` が空でも添付があれば送る
   - 添付のみ + 全滅した場合はユーザーに失敗を返す（Telegram と同じ扱い）
3. `packages/bridges/discord/test/test_attachments.ts` を追加、package.json に
   `test` script（tsx）と eslint.config.mjs を mastodon / telegram に揃えて追加

## スコープ外（別 issue にする）

- **Mastodon も添付のみの DM で壊れている**: `handleNotification` は
  `parsed.text` が空でも `mulmo.send(acct, "")` を呼ぶので、サーバの
  `text is required` で弾かれる。同じプレースホルダ処理が要る。
- `readCappedBody` 相当が mastodon と discord で重複する。共通化するなら
  `@mulmobridge/client` に置くのが筋だが、client → discord の順で publish が
  必要になり本 fix の出荷が遅れるため、フォローアップに回す。
