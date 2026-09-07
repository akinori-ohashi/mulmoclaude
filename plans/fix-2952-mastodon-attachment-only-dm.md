# Mastodon の画像だけ DM (#2952)

**Status**: implementing
**Tracks**: #2952
**Last updated**: 2026-08-25

## 起票時の前提は誤りだった（実測で訂正済み）

「画像だけの DM は `parsed.text` が空になり、サーバに拒否される」と書いたが、
実物のパーサに実際の `content` 形状を通したところ **`text = "@bot"`** だった。

```text
image-only DM (mention alone)      htmlToText="@bot"                → text="@bot"
image-only DM (trailing space/br)  htmlToText="@bot"                → text="@bot"
mention + caption                  htmlToText="@bot what is this?"  → text="what is this?"
reply with media, no body at all   htmlToText=""                    → text=""
```

原因は `stripLeadingMentions` の `SINGLE_MENTION_RE` が **末尾の空白 `\s+` を要求**していること。
メンションで本文が終わると剥がれない。

## 実際の欠陥（2つ、連動している）

1. 画像だけの DM は届いてはいるが、本文が `"@bot"` という無意味な文字列になる
2. 本文が完全に空のメディア返信は `text is required` で拒否され、画像が失われる

1 だけを直す（末尾メンションを剥がす）と、`"@bot"` が `""` になって
**今は届いている画像だけ DM が落ちるようになる**。2 のプレースホルダとセットでしか直せない。

## 実装

1. `parse.ts` — `SINGLE_MENTION_RE` の末尾を `(?:\s+|$)` に。差分検証で
   「旧が末尾メンションを残していた入力でのみ挙動が変わる」ことを確認（54,061 入力、
   差異 5,870 件、想定外 0 件）。ジェネレータと性質は恒久テストに移した
2. 新規 `src/media.ts`（純粋・テスト可能。`index.ts` は起動時に env を読んで
   `process.exit` するので import できない）
   - `imageMediaEntries` — image 型の media だけを取り出す
   - `hasRelayableContent` / `isLostImagesOnly` — 送信可否のガード
   - `resolveMessageText` — 空本文のプレースホルダ、落とした添付の注記
3. `index.ts` — `relayStatus` に分離。全滅時は失敗を返信、一部失敗は本文に注記、
   ログに `dropped=` を追加

## 挙動の変化（PR で明記する）

| ケース                       | 変更前                      | 変更後                                   |
| ---------------------------- | --------------------------- | ---------------------------------------- |
| `@bot` + 画像                | 本文 `"@bot"` で届く        | `"Describe / analyze this file."` + 画像 |
| 本文なしメディア返信         | `text is required` で消える | 届く                                     |
| 画像 DL 全滅・本文なし       | 本文なしで送って拒否        | 失敗を返信                               |
| 素の `@bot` だけ（画像なし） | `"@bot"` として届く         | **無視** ← 要判断                        |

## スコープ外

- `fetchImageAttachment` が `content-type` をパラメータごと `mimeType` に入れている
  （`image/jpeg; charset=binary` のような値が Claude API にそのまま渡る）。
  Discord 側では除去したが、Mastodon 既存挙動の変更になるので別途
- `"Describe / analyze this file."` が telegram / line / discord / mastodon の4箇所に複製。
  `@mulmobridge/client` への集約は publish 順の都合で別 PR
