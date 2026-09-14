# fix(#3164): `[[wiki-link]]` を marked 拡張にする

Issue: https://github.com/receptron/mulmoclaude/issues/3164

## 直す不具合

ウィキページのコードブロックに `[[Home]]` を書くと、アプリ内部の nonce を含む span のソースが表示される。

```
`[[Home]]`  ->  <code>&lt;span data-app-markup="e4849cce-…" class="wiki-link" …&gt;</code>
```

セキュリティ穴ではない（nonce はレンダリング毎・使い捨て）。表示品質の問題。

## 根本原因

`renderWikiPageHtml` は `marked.parse` の**前**に文字列を書き換える。`renderWikiLinks` は純粋な文字列ウォーカーで
markdown の構造を知らないため、コードフェンスの中にも span を注入してしまう。

`wikiEmbeds.ts` のヘッダには、まさにこの理由で embed 側は拡張にしたと書かれている:

> `[[...]]` inside fenced / inline code blocks is left alone because the marked tokenizer never
> reaches `code` content; a regex on the rendered HTML would have to skip `<pre><code>` blocks itself.

link だけがその扱いを受けていなかった。

## 直し方

`[[...]]` を marked の inline 拡張にする。`wikiEmbedExtension` と同じ形。

トークナイザのパターンは **core の `WIKI_LINK_PATTERN` をそのまま使う**（アンカーだけ付ける）。自前で書き直すと
lint / グラフ / backlinks と乖離しうる — core 側にその parity テストが既にある。

## これで消えるもの

拡張の出力は `renderer.html` を通らない＝ポリシーから見て「著者のHTML」ではなくなるので、#3151 で入れた
app-markup nonce 機構が丸ごと不要になる:

- `APP_MARKUP_ATTR` / `createAppMarkupNonce` / `withTrustedAppMarkup`
- `leadingMarkerAt` / `removeMarkerAt` / `trustedMarker` / `trustedNonce`
- `isStripped` のマーカー分岐
- それらを守るテスト群（4ファイル 39 箇所）

**セキュリティ機構が減るのが本件の主目的。** #3151 のレビューでは nonce 自体に P1 が1件出ている（著者は nonce を
当てる必要がなく、`<div class="absolute" data-x="[[Home]]">` と書けばアプリに自分のタグへ注入させられた）。
機構がなくなれば、その攻撃面も消える。

## スコープの判断 — グローバル登録は**しない**

`wikiEmbedExtension` はグローバル登録されているが、**wiki link は wiki ページの描画時だけ**にする。

理由: グローバルに登録すると、チャット（`textResponse` / markdown-plugin）で `[[Foo]]` と書いたときの表示が
「`[[Foo]]` という文字列」から「`Foo` というリンク」に変わる。これは依頼されていない挙動変更。

実装: 拡張は setupMarked で登録し、tokenizer は**モジュールスコープの真偽値が立っているときだけ**発火する。
`renderWikiPageHtml` が自身の同期 parse をその窓で囲う。

nonce と同じ「離れた場所の状態」だが、はるかに単純で、かつ**偽造の心配がない** — このフラグが決めるのは
「`[[x]]` をリンクにするか」だけで、著者が悪用できる対象ではないため、CSPRNG も位置検査も要らない。

## 挙動変更（意図的）

| 入力 | 変更前 | 変更後 |
|---|---|---|
| 本文の `[[Home]]` | span | span（同じ） |
| コード内の `[[Home]]` | **span のソースが露出** | `[[Home]]` がそのまま見える |
| チャットの `[[Home]]` | `[[Home]]` | `[[Home]]`（変えない） |

## 検証

- **パーサの unit test を厚く書く**（tokenizer の発火/非発火、`|` 分割、エスケープ、境界、異常系の両方向）
- **差分テスト**: 旧 `renderWikiLinks` と新拡張を、生成した `[[...]]` 入力で突き合わせ、コード外では一致することを示す
  （CLAUDE.md の「挙動が同じ、は両方走らせて示す」）
- **順序テスト**: `[[amazon:B00ICN066A]]` が embed のまま奪われないこと
- **スコープテスト**: 窓の外では発火しないこと、throw しても窓が閉じること
- 既存の wiki e2e と全テストが緑

## 範囲外

`stripPresentationAttributes`（著者 raw HTML から class/style を剥がす走査器）は残す。役割が別。
`renderWikiLinks` は `@mulmoclaude/core/wiki` の公開APIなので**削除しない** — MulmoTerminal が参照しうる。
このホストが呼ばなくなるだけ。
