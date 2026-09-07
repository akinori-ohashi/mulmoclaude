# #2924 — 予算が尽きたら画像を落とすのではなくページを短くする

## 症状

phone（mobile）ビューで、特定の 1 アイテムだけサムネイルが出ずプレースホルダーになる。
エラーは一切出ない。レコードも画像ファイルも正常で、同じパスを `view-data/image` に
手で投げれば 200 が返る。

## 原因（実測で確定）

**クライアントのバグではない。予算制インライン化の、設計どおりの縮退。**

1. mobile ビューには **token も dataUrl も渡らない**（`RemoteViewBoot` のコメントに
   "note what is ABSENT compared to the desktop boot: no token, no dataUrl, no origin"）。
   つまり `view-data/image` によるオンデマンド取得は**原理的に不可能**。mobile で画像が
   出る経路はサーバ側インライン化 1 本だけ。
2. そのインライン化は 1 ページ `REMOTE_VIEW_ITEMS_MAX_BYTES = 900_000` バイトの予算制で、
   超えた欄は**パスのまま**返る（`plans/done/feat-remote-view-images.md` §4 の決定）。
3. `inlineImages` は入らなかったとき `used` を進めない。よって「予算超過以降が全部落ちる」
   のではなく、**入らなかったその 1 枚だけが落ちて、後続の小さい画像は通る**。

### なぜ境界に乗るのか（実測）

実写を `thumbnail-store.ts` と同じパイプライン（rotate → fit inside → JPEG q72）で通した:

| maxEdge | dataUrl 1 枚 | 900KB に入る枚数 |
|---|---|---|
| 256 | 7–9 KB | 98–119 |
| 384 | 15 KB | 58 |
| 512（既定） | 22–25 KB | 35–40 |

既定の `limit` は 50（`DEFAULT_PAGE_LIMIT`）。384px × 50 = 約 750KB で、残り 150KB に
レコード本体の JSON が乗る。**50 件ページは予算の境界すぐ上に着地する**ため、
最後の数件、実際にはそのページで一番大きいサムネイル 1 枚が落ちる。

## 変更

> 予算が尽きたら「画像を落とす」のではなく「**ページを短くする**」。

`RemoteViewPage` は `{ items, total, offset, limit }` を返し、help の定石は
`offset: loaded.length` / 停止は `loaded.length >= total`（`custom-view-remote.md`）。
**短いページを返しても、この定石のビューは正しく続きを取りに行く。**

- 画像が 1 枚も失われない（原因不明の穴が消える）
- ビューは既存の pagination で続きを取る（スクロールが 1 回増えるだけ）
- `total` は据え置きなので「もっと見る」の判定は不変

## 必ず守ること

1. **0 件のページを絶対に返さない。** 先頭アイテムの画像すら入らない場合は、その 1 件だけは
   画像をパスのまま返す（従来の縮退）。さもないとビューは同じ offset を無限に要求する。
2. `total` は切り詰めない。切り詰めるのは `items` だけ。
3. `page.limit` は実際に返した件数に合わせる。`offset += page.limit` で進めるビューも
   飛ばさずに済む（自前の定数で進めるビューは救えない。help に明記する）。

## 検証

- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`
- ユニットテスト:
  - 予算が尽きるとページが短くなり、落ちる画像が 0 になる
  - 先頭 1 件すら入らないときは 1 件返す（0 件にしない）
  - `total` が変わらない / `limit` が返却件数に一致する
  - 画像欄が無いビューは従来どおり満杯のページ
- 実測で「limit=50 / 384px が境界」を再確認し、変更後にページが何件に切り詰められるかを出す。
