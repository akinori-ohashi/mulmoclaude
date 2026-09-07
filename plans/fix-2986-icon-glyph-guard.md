# fix(icons): material 名でない `schema.icon` を安全に描く（＋絵文字を正式サポート）

Issue: #2986 / refs #2960

## 問題（実測済み）

`CollectionSchema.icon` / `FeedSummary.icon` / `Shortcut.icon` は `z.string().trim().min(1)` で
**形式チェックが無い自由文字列**。一方、描画側は 11 箇所すべてで値が Material Symbols の
リガチャ名である前提で `<span class="material-symbols-outlined">{{ icon }}</span>` に流している。

実フォント（`node_modules/material-symbols/outlined.css`）＋ `PluginLauncher.vue` の
グループ2ピルと同一クラスを Playwright で描画して確認した結果:

- 不正名（`not_a_glyph`）→ リガチャが一致せず **リテラル文字が 32px 枠を突き抜けて隣接ボタンに重なる**。
  `overflow-x-auto` はクリップしない。
- 絵文字（`🎙️` `📰` `📚`）→ フォントフォールバックで **フルカラーのまま 32px 枠内に正しく収まる**。
  バリデーションも既に通る。

つまり「絵文字は偶然動く」と「不正名は壊れる」が同居している。リグレッションではなく、
`984634897 feat: pin frequently-used collections & feeds to the launcher` 以来の長期的な穴。

## 方針

`icon` の値を分類する **純関数を core に 1 つ** 置き、描画側は全箇所でそれを通す。

- material 名 → 従来どおりアイコンフォント
- それ以外 → **先頭 1 グラフェムだけ**をプレーン span で描画

1 グラフェムに切り詰めるので、**構造上はみ出しようが無くなる**（長さに依存しない）。
副産物として絵文字が正式サポートになる ＝ #2960 が求める「テキストを増やさない識別性」への答え。

### ⚠️ 実測で設計が変わった: 正規表現だけでは足りなかった

当初は「material 名の正規表現に通れば安全」という設計だったが、**実ブラウザの e2e で反証された**。

`not_a_glyph` は小文字＋アンダースコアなので `/^[a-z0-9_]+$/` に**通ってしまう**が、
フォントに該当リガチャは無いので結局テキストとして描画され、計測値で **116.5px はみ出した**。
実際のタイポ（`podcast` / `rss` / `not_a_glyph`）はまさにこの形をしており、
正規表現が弾けるのは `Podcasts` / `menu-book` のような**別種のタイポだけ**だった。

ユニットテストはこれを「仕様どおり」として通していた（`not_a_glyph` は symbol、と書いていた）。
**ブラウザで測ってはじめて分かった**類のバグ。

#### 対処: CSS で箱を閉じる（構造的な担保）

実フォントで幅を計測したところ:

| 値 | 16px での実測幅 |
|---|---|
| `podcasts` / `rss_feed` / `menu_book` / `3d_rotation` | **すべて 16px（＝ちょうど 1em）** |
| `not_a_glyph`（解決できない名前） | **176px（11 倍）** |

解決されたリガチャは**必ず 1em** に収まるので、`inline-block w-[1em] overflow-hidden` を
アイコン span に付ければ **正当なアイコンには一切影響せず、外れた名前だけが箱の中に収まる**。

`overflow:hidden` は inline-block のベースラインを変えるため、flex ボタン内と本文インラインの
両方で位置を計測して確認した → **幅・高さ・親からのオフセットすべて変化なし**（`line-height:1` のため）。

3896 名のリストを実行時に持てば「存在しない名前」を検出できるが、フォントのバージョンと
同期し続ける必要があり、この PR には見合わない。**箱を閉じる方が安く、陳腐化しない。**
（値が間違っていること自体は見た目で分かるままにし、直し方は `error-recovery.md` に書く。）

### 正規表現は推測せず実測で決めた

`material-symbols/index.d.ts` の全 3896 名を走査して確認:

- 使われている文字は **`[0-9_a-z]` だけ**
- 3896 名すべてが `/^[a-z0-9_]+$/` に一致（不一致 0 件）、最長 43 文字

よって `MATERIAL_SYMBOL_NAME_RE = /^[a-z0-9_]+$/`。

既存の `src/utils/role/icon.ts` は `/^[a-z_]+$/`（数字なし）を使っており、`123` / `10k` /
`3d_rotation` / `18_up_rating` のような**数字を含む正当なアイコン名を弾いてしまう**。
ただしロールは別フォント（material-icons）かつ**安全なフォールバックがある**（はみ出さない）ので、
この PR では触らず PR 本文で報告するに留める。

### グラフェム分割に `Intl.Segmenter` を使う理由

`Array.from("🎙️")[0]` は VS16 を落として `"🎙"` になり、**カラー絵文字が白黒の文字グリフに化ける**。
`Intl.Segmenter` は書記素クラスタ単位で切るのでこれが起きない。
未実装環境向けにコードポイント単位のフォールバックを持つ。

## 実装

### 1. core: 純関数（新規）

`packages/core/src/collection/core/iconGlyph.ts`（`@mulmoclaude/core/collection` から re-export）

```ts
export type IconGlyph =
  | { kind: "symbol"; name: string }  // Material Symbols リガチャ名
  | { kind: "glyph"; text: string };  // そのまま描く 1 グラフェム

export function resolveIconGlyph(raw: string | undefined, fallback: string): IconGlyph;
```

- `raw` が空／空白のみ → `fallback` を使う（既存の `feed.icon || "dynamic_feed"` 等をこれに寄せる）
- `fallback` も material 名でなければ同じ規則で glyph 扱い（全域関数、例外を投げない）

### 2. Vue: 薄い描画コンポーネント（host / plugin に各 1）

core は `.vue` SFC を持たない（`plugin-vue` は composable のみ、ビルドに `@vitejs/plugin-vue` 無し）。
core に SFC を持ち込むのはビルド構成の変更を伴い、この PR の目的に見合わない。
**判断: 規則（純関数）は core に 1 つ、描画は各 Vue ツリーに薄い SFC を 1 つずつ**置く。

- `src/components/IconGlyph.vue`
- `packages/plugins/collection-plugin/src/vue/components/IconGlyph.vue`

props: `icon?: string` / `fallback?: string` / `sizeClass?: string`（`text-base` 等）。
glyph 側は絵文字が小さく見えるのでアイコンより 1 段大きい行送りゼロの span で描く。

### 3. 差し替え対象（ユーザー/LLM 由来の値のみ）

host:
- `src/components/PluginLauncher.vue:70`
- `src/components/ShortcutReorderPopover.vue:41`
- `src/components/DashboardView.vue:41`

collection-plugin:
- `CollectionsIndexView.vue:179`
- `CollectionHeader.vue:16` / `:132`（関連）/ `:159`（アクション）
- `FeedsView.vue:54`
- `DiscoverPanel.vue:28`
- `CollectionViewConfigModal.vue:34`
- `CollectionToolbar.vue:134`
- `CollectionRecordPanel.vue:55`
- `CollectionMutateParamsModal.vue:12`

**対象外（意図的）**: `NewCollectionModal.vue:62` の `starter.icon` は組み込み定数で、
ユーザー/LLM が値を決めないため壊れようが無い。`progress_activity` 等のリテラルも同様。

### 4. ドキュメント

- `docs/shared-utils.md` に 1 行追記（同 PR 内、CLAUDE.md 規約）
- `packages/core/assets/helps/error-recovery.md` に「アイコンが文字で表示される／隣に重なる」の項を追加
  → `@mulmoclaude/core` の version bump が必要（`files: ["dist","assets"]`）
- `manageTool.ts` の `putSchema` 説明に「`icon` は Material Symbols 名、または絵文字 1 文字」を明記

## テスト

### 1. 純関数のユニットテスト — `test/utils/collections/test_iconGlyph.ts`（node:test）

正常系と異常系の両方向:
- material 名（数字入り `123` / `10k` / `3d_rotation` を含む）→ `symbol`
- 絵文字（VS16 付き `🎙️`、ZWJ 連結 `👨‍👩‍👧`、肌色修飾、旗）→ `glyph` で **1 グラフェムのまま崩れない**
- 大文字 / 空白入り / ハイフン / 日本語 / 長文 → `glyph` かつ **必ず長さ 1 グラフェム**
- 空文字 / 空白のみ / `undefined` → `fallback`
- `fallback` 自体が material 名でない場合
- 3896 名の実リストを回して全部 `symbol` に落ちること（回帰の網）

**このユニットテストだけでは不十分**（上記のとおり `not_a_glyph` を「正常」と判定して通してしまう）。
はみ出しは**幾何の性質**なので、実ブラウザで測るしかない。

### 2. 実ブラウザの回帰テスト — `e2e/tests/shortcut-icon-glyph.spec.ts`（Playwright）

正常名／解決できない名前／絵文字を混ぜたショートカットを実際にランチャーへ並べ、

- 解決できない名前の glyph が 32px ボタンからはみ出さない（**px で計測**）
- 両隣のボタンが自分の中心座標で `elementFromPoint` に取れる（＝重なっていない）
- どの値でもボタン幅が 32px のまま
- 絵文字は `material-symbols-outlined` を**持たない** span で、そのまま描画される
- 正当な名前は従来どおりアイコンフォントへ行く

**ピクセルスナップショットは意図的に置かない**: CI は Linux、手元は macOS で、絵文字はホストの
絵文字フォントが描くため、ベースラインは「挙動」ではなく「著者のマシン」を焼き付けることになる。

## 検証

- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`
- **描画の実機確認**: ランチャーに「正常名／不正名／絵文字」を混ぜたショートカットを置き、
  修正前後をスクリーンショットで比較（build 成功は描画の証拠にならない、の規約どおり）
