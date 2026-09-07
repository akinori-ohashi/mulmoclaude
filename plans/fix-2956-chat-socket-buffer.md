# ソケットの 1MB 既定バッファ (#2956)

**Status**: implementing
**Tracks**: #2956
**Last updated**: 2026-08-25

## 問題

`attachChatSocket` が `maxHttpBufferSize` を設定していないため Socket.IO 既定の
1,000,000 バイトが効き、**生バイトで約 730KB を超える添付でソケットが切断**される。
同じファイルの `parseAttachments` は base64 20MB を上限に持っており、**到達不能**だった。

添付を扱う全ブリッジ（Discord / Telegram / LINE / Mastodon）に影響する。

## 実測

| 生サイズ | base64 | 修正前 | 修正後 |
|---|---|---|---|
| 100 KiB | 133 KiB | 届く | 届く |
| 700 KiB | 933 KiB | 届く | 届く |
| 900 KiB | 1200 KiB | **切断** | 届く |
| 8 MiB | 10923 KiB | 切断 | 届く |
| 14 MiB | 19115 KiB | 切断 | 届く |
| 15 MiB | 20480 KiB | 切断 | 届く（添付上限ちょうど） |
| 20 MiB | 27307 KiB | 切断 | 切断（トランスポート上限超え） |

## 実装

`MAX_SOCKET_PAYLOAD_BYTES = MAX_ATTACHMENT_TOTAL_BYTES + 4MB` を `maxHttpBufferSize` に。
上限の宣言を `attachChatSocket` より上に移動しただけで、値は変えていない。

`parseAttachments` の 20MB / 10件はそのまま実効ゲートとして残る。
ソケットはハンドシェイクでトークン検証済み・loopback 前提。

## テスト

`test_socket.ts` に 2MiB（base64 約 2.7MB）の添付が relay に届くことを確認するテストを追加。
**修正を外すと 29ms で落ちる**ことを確認済み（`emitMessageWithTimeout` で ack 待ちを
5秒で打ち切る。素の `emitMessage` だとハングして CI のジョブ時間を食い潰す）。

## 残る課題（スコープ外）

アプリ上限（20MB）とトランスポート上限（24MB）のあいだのサイズは `parseAttachments` が
`break` して無言で添付を落とす。ack は成功で返る。本来はエラーを返すべき。
