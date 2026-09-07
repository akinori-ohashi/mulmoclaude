# feat(icons): ショートカットにアクセントカラー（淡い地色）を持たせる

Issue: #2987 / refs #2960 / 前提: #2986（PR #2988, merged）

## 問題

`#2960` の実際の困りごとは「`podcasts` / `rss_feed` / `menu_book` のような**同系統の汎用グリフ**が
並ぶと見分けられない」こと。#2986 で「グリフの語彙を増やす」軸（絵文字）は解決したが、
**汎用グリフのまま使いたい場合**の識別性はまだ無い。

実フォント＋実ボタン CSS で比較した結果（#2988 で計測済み）:

- アイコンの**文字色だけ**を変える案は、16px では色面積が細く効果が弱い
- **淡い背景チップ**は、同一の汎用グリフのままでも並びの中で明確に区別できた

## 決定事項（ユーザー確認済み）

| 論点 | 決定 | 理由 |
|---|---|---|
| **適用範囲** | **ランチャー周りだけ** — `PluginLauncher`（32px ショートカット）／`ShortcutReorderPopover`／`DashboardView` タイル | いずれも現在無地（白／グレー）で、#2960 の困りごとが実際に起きている場所。**コレクション一覧カードは対象外**: あそこのチップ色は `source === 'project' ? 藍 : 紫` で **project / user の区別という既存の意味を持っており**、アクセント色で上書きするとその signal が消える |
| **色の決め方** | **明示指定のみ** — `schema.color` があればその色、無ければ従来どおり無地 | 意図したものだけが色づくので予測可能。slug ハッシュ自動配色は採らない（色に意味が無く、slug 変更で色が変わる） |

## 設計

### パレットは core に、クラスは書き下す

`enumColors.ts` の確立したパターンに従う。Tailwind は**完全な文字列リテラルしか検出しない**ため、
色名から実行時にクラスを組み立てず、色ごとに書き下す。

```ts
// packages/core/src/collection/core/accentColor.ts
export const ACCENT_COLORS = ["violet", "indigo", "sky", "teal", "emerald", "lime", "fuchsia"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];
export function accentChipClasses(color: string | undefined): string | null;
```

**7 色にした経緯（計画時は 8 色だった）**: 候補 8 色を**同一グリフ**で実ブラウザに並べたところ、
`cyan` が `sky` と `teal` のちょうど中間に来て、1 つのピルに同系統の青緑が 3 つ並びうることが
分かったので `cyan` を落とした。見分けられない色は識別の役に立たないため、色数ではなく分離を優先する。

`enumColors` と同じく**暖色帯（red / orange / amber）は意図的に除外**する。あちらでは通知の
severity（`ENUM_ALERT` 赤 / `ENUM_NUDGE` 橙）に予約されており、ランチャーで暖色を使うと
「通知が来ている」ように読めてしまう。

未知の色名・未指定は `null` を返し、呼び出し側は従来の無地にフォールバックする
（**バリデーションで弾かず描画で無害化する** — `icon` と同じ方針）。

### #2989 との関係（Tailwind スキャン問題）

`@mulmoclaude/core` にしか literal が無い Tailwind クラスは、プラグインのパッケージビルドの
`dist/style.css` に出ない（#2989、PR #2994 で `@source` ＋ CI ゲートが入った）。

**今回は `@source` の追加が不要**: アクセント色を**描画するのはホスト（`src/components/*`）だけ**で、
ホストの Vite root はリポジトリ全体なので core は既にスキャンされている。プラグイン側は
色を**運ぶ**だけで描画しない。`check-plugin-tailwind-source.mjs` は「そのクラスを**描画する**
プラグイン」だけを見るので、ゲートも緑のまま。適用範囲をランチャーに絞った副次的な利点。

### アクティブ状態との関係

ショートカットボタンは現在アクティブ時 `bg-blue-50 text-blue-600`。
**アクティブ時は従来どおり青のまま**とし、アクセント色は非アクティブ時にだけ出す。

理由: アクティブは「今ここにいる」という別の意味を持つ signal で、識別色より強い。
両立させるために ring や border を足すと新しい視覚語彙が増え、
「現状の枠組みで UI を大きく変えない」という前提から外れる。

## 実装（データの流れ順）

### core
1. `collection/core/accentColor.ts`（新規）— パレット＋`accentChipClasses`
2. `collection/core/schemaZ.ts` — `CollectionObjectZ` に `color: z.enum(ACCENT_COLORS).optional()`
3. `collection/core/uiTypes.ts` — `CollectionSummary.color?` / `FeedSummary.color?` / `CollectionShortcutInfo.color?`
4. `collection/server/discovery.ts` `toSummary` — `color` を載せる
5. `collection/index.ts` — re-export
6. `collection/server/manageTool.ts` — `putSchema` 説明に `color` を追記

### server
7. `server/workspace/feeds/summaries.ts` — `summarize` に `color` を載せる

### host
8. `src/types/shortcuts.ts` — `Shortcut.color?`
9. `src/composables/useShortcuts.ts` — `reconcile` が `color` も比較・更新する
10. `src/components/PinToggle.vue` — `color` prop を受けて pin 時に載せる
11. `src/components/PluginLauncher.vue` / `ShortcutReorderPopover.vue` / `DashboardView.vue` — チップ描画

### plugin（運ぶだけ・描画しない）
12. `CollectionsIndexView.vue` / `FeedsView.vue` — `reconcileShortcuts` と `pinToggle` に `color` を渡す

**pin 時にも色を載せる理由**: reconcile は一覧を開くたびに走るので、載せ忘れても次回の
一覧訪問で自己修復はする。ただしそれだと**ピン留めした直後だけ色が出ない**という見え方になるので、
pin 時にも渡す。

## テスト

### ユニット `test/utils/collections/test_accentColor.ts`
- 8 色すべてがクラスを返す／返すクラスが Tailwind リテラルとして完全形である
- 未指定・空文字・未知の色名・大文字・型外の値 → `null`（無地フォールバック）
- 暖色帯（red / orange / amber）がパレットに**含まれない**こと（通知色との衝突防止を明示的に固定）

### e2e `e2e/tests/shortcut-icon-glyph.spec.ts` に追加
- `color` 付きショートカットが地色クラスを持ち、無指定は従来どおり無地
- **アクティブなショートカットは青のまま**（アクセント色に上書きされない）

## 検証

- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test` → `yarn test:e2e`
- **実機描画**: 色付き／無指定／アクティブを混ぜたショートカットを実ブラウザで描画し、
  背景色が実際に適用されていることを**計算後のスタイルで確認**する
  （core にしか literal が無いクラスなので、「クラス名が付いている」だけでは不十分 — #2989 の教訓）
