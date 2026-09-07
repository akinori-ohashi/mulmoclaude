# #2940 — 非 ASCII（CJK）タイトルの wiki ページが解決できない

## 症状

`data/wiki/pages/不耕起栽培-カバークロップ4年計画.md` が存在するのに

- `GET /api/wiki?slug=不耕起栽培-カバークロップ4年計画` → `pageExists: false`
- instructions が `wiki/pages/-4.md does not exist` という壊れたパスを提示する
- lint が `[[不耕起栽培-カバークロップ4年計画]]` を無条件で Broken link にする

報告者の環境では 50 ページ中 44 ページが該当。

## 原因（一時ワークスペースで実測して確定）

`pageIndex.ts:42` が作る `slugs` の**キーは生のファイル名 stem**（`不耕起栽培-…`）。
一方、引く側は必ず `wikiSlugify(target)` を通してから引いている。

```ts
wikiSlugify("不耕起栽培-カバークロップ4年計画") === "-4"
```

つまり **生の target で引くステップがどこにも無い**ため、非 ASCII 名は原理的にヒットしない。
`resolvePagePath` の index タイトル一致フォールバック（#1194 の想定）だけが頼りだが、
index.md の表示タイトルは可読性のため記号・スペース入りにするのが自然で、ファイル名とは一致しない。

同じ欠陥が 3 箇所にある:

| 箇所 | 症状 |
|---|---|
| `wiki/server/engine.ts` `resolvePagePath` | ページが開けない（`pageExists:false`） |
| `wiki/lint.ts` `findBrokenLinksInPage` | 誤 Broken link（タイトル一致フォールバックすら無い） |
| `wiki/graph.ts` `resolveLinkTarget` | グラフの辺が落ちる |

書き込み側（`server/workspace/wiki-pages/io.ts`）は `isSafeSlug` を使っており **非 ASCII 名を許可している**。
ルータガード（`wiki/route.ts`）も「Non-ASCII characters (e.g. Japanese page titles) are allowed」と明記。
壊れているのは読み取り／解決側だけで、この修正は既存の設計意図に沿う。

## 変更

> `[[link]]` の target を既知スラグに突き合わせるルールを 1 つの純粋関数にまとめ、
> **literal 一致を slugify 一致より先に**試す。

新規 `packages/core/src/wiki/resolve.ts`:

```ts
matchWikiSlug(target, known)  // literal → wikiSlugify、どちらも無ければ null
```

`known` は `has(slug)` を持つもの（`Map<slug, filename>` も `Set<slug>` も満たす）。

適用先:

1. `engine.ts` `resolvePagePath` — literal/slugify 一致 → fuzzy → index タイトル一致（後半は不変）
2. `lint.ts` `findBrokenLinksInPage` — 同じ関数を共有。空 target の診断は `target.trim()` で判定
3. `graph.ts` `resolveLinkTarget` — literal 一致を先に
4. `server/api/routes/wiki.ts` — 「作るべきファイル名」を示す instructions が `-4.md` にならないよう、
   非 ASCII を含む名前はそのまま提示する（ASCII は従来どおり slugify）

副次的に、`MyPage.md` に対する `[[MyPage]]`（大文字混じり）も解決するようになる（現状は null）。

## スコープ外（別 issue にする）

`index.md` を `- [[不耕起栽培-…]]` 形式で書いた場合、`index-parse.ts:169` が entry.slug を
`wikiSlugify` で作るため `-4` になり、Missing file / Orphan page が誤検出される。
既知スラグ集合を持たないパース時の話で、独立に revert できるため本 PR には含めない。
（報告者は `- [Title](pages/….md)` 形式なのでこの症状には当たっていない）

## 検証

- 修正前の実測: `resolvePagePath(CJK) === null`、lint が `-4.md not found` を出す（再現済み）
- ユニットテスト:
  - `matchWikiSlug`: literal 一致 / slugify 一致 / literal 優先 / 空 / 未知
  - `resolvePagePath`: 実 fs フィクスチャで CJK ファイル名が解決する
  - `findBrokenLinksInPage`: 実在する CJK リンクは無警告、不在の CJK リンクは Broken link（"empty target" ではない）
  - `resolveLinkTarget` / グラフ: CJK リンクの辺が張られる
- **修正を revert するとこれらが赤になることを確認する**
- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`

## 既存テストの更新

`test_lint.ts` の「pure non-ASCII は empty target 扱い」テストは、本修正が意図的に変える挙動なので
「実在すれば無警告 / 不在なら通常の Broken link」に書き換える。

## リリース

`@mulmoclaude/core` は npm 公開パッケージなので、npm 経由ユーザーに届けるには別途 publish が必要。
