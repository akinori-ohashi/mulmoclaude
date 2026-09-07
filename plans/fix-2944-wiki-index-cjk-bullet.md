# #2944 — `- [[非ASCII名]]` 形式の index.md が Missing file / Orphan page を誤検出する

## 症状

`index.md` を `- [[ページ名]]` 形式で書いている場合、非 ASCII 名のページが
**Missing file と Orphan page の両方**で同時に誤検出される。

実測（`parseIndexEntries` + lint を直接実行）:

```ts
parseIndexEntries("- [[不耕起栽培-カバークロップ4年計画]] — 概要")
// → [{ slug: "-4", title: "不耕起栽培-カバークロップ4年計画" }]

findMissingFiles(entries, new Set(["不耕起栽培-カバークロップ4年計画"]))
// → ["- **Missing file**: index.md references `-4` but the file does not exist"]
findOrphanPages(new Set(["不耕起栽培-カバークロップ4年計画"]), new Set(["-4"]))
// → ["- **Orphan page**: `不耕起栽培-カバークロップ4年計画.md` exists but is missing from index.md"]
```

#2940（PR #2943）で解決側 3 箇所は直したが、そこはいずれも「既知スラグ集合に
突き合わせる」ので `matchWikiSlug` で足りた。**パース時点には既知スラグ集合が無い**ため
別ルールが要り、独立に revert できることからスコープ外にしていた。本 PR がその残り。

## 原因

`packages/core/src/wiki/index-parse.ts`:

- `parseBulletWikiLinkRow`（`- [[…]]` 形式）: `wikiSlugify(target)` で slug を作る
- `parseBulletLinkRow`（`- [Title](href)` 形式）: href から stem を取れないとき
  `wikiSlugify(title)` に落ちる

`wikiSlugify` は非 ASCII を全削除するので、ファイル名 stem（＝ page index のキー）と
永久に一致しない。

## 変更

slug 導出を `wikiPageStem(name) ?? wikiSlugify(name)` にする。
`wikiPageStem` は #2943 で入れた「作るべきファイル名」の規則:

- 非 ASCII を含み、かつファイル名として安全 → **生のまま**
- ASCII → 従来どおり slugify（`- [[Sakura Internet]]` → `sakura-internet`）
- ファイル名にできない名前 → null なので `wikiSlugify` に落として従来挙動を保つ

適用は 2 箇所（`parseBulletWikiLinkRow` / `parseBulletLinkRow` の title フォールバック）。
テーブル形式は slug 列をそのまま使うので対象外。

## 副作用として直るもの

`findTagDrift` は `frontmatterTagsBySlug.get(entry.slug.toLowerCase())` を引く。
これまで非 ASCII ページの entry.slug は `-4` だったので**タグ差分の検査自体が
黙って飛ばされていた**。今回から実際に検査されるので、既存 wiki で新たに
（正しい）Tag drift が出ることがある。

グラフのノードタイトル（`titleBySlug`）も正しい entry を引くようになる。

## 検証

- 修正前の実測を上に記録済み（誤検出の再現）
- ユニットテスト:
  - `test_indexParse.ts`: `- [[非ASCII名]]` が生 stem、ASCII は slugify のまま、
    ファイル名にできない名前は従来どおり
  - `test_lint.ts` / engine の fs フィクスチャ: `- [[非ASCII名]]` 形式の index で
    Missing file / Orphan page が出ないこと
- **修正を revert するとこれらが赤になることを確認する**
- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`
