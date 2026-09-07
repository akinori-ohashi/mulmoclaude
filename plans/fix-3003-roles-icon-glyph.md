# fix(roles): ロール管理画面の生 `role.icon` 描画を分類してから描く

Issue: #3003 / 前提: #3001（PR、merged）/ 同じファミリ: #2986, #2605

## 問題（実測済み）

ロールの管理系 3 画面は `roleIcon()` を通さず、保存された `role.icon` を**そのまま**
`<span class="material-icons">` に流している。Material Icons はリガチャで解決するので、
**解決できない名前はリテラル文字として組まれ、行を押し広げる**。

| 値 | ロール一覧の行（24px） | プレビュー行（12px） |
|---|---|---|
| `school`（実在） | 24px = **1em** | — |
| `not_a_glyph` | **264px = 11em** | **132px = 11em** |
| `🤖` | 24px = 1em | 15px = **1.25em** |

`not_a_glyph` の行はロール名が右端まで押し出され、**2 行に折り返す**（実測・スクリーンショット確認済み）。

## なぜ #3001 の containment では直せないか

PR `#3001` では `roleIcon()` の結果を描画する 7 箇所に `w-[1em] overflow-hidden` を入れたが、
**この 3 画面は対象外**にした。理由は上の表のとおり:

- これらの画面は「**入力した値をそのまま見せる**」のが目的で、**絵文字が正しく描画されている**
- 絵文字は **1.25em になることがある**（プレビュー行）ので、1em で切ると**絵文字が欠ける**

つまり「一律に箱を閉じる」では直せない。**値が何であるかを分類してから描く**必要がある。

## 方針: 既存の `IconGlyph` を再利用する（フォントだけ差し替え可能にする）

`packages/core/src/plugin-vue/IconGlyph.ts` が既に**まさにこの処理**をしている:

- material 名（`/^[a-z0-9_]+$/`）→ アイコンフォント、**1em に閉じる**
- それ以外（絵文字など）→ **先頭 1 グラフェム**をプレーン span、**1.25em に閉じる**

唯一の障害は `material-symbols-outlined` をハードコードしている点。
**任意の `fontClass` prop（既定は現状値）を足す**だけで解決する。

- **加算的な変更**なので、既存 12 箇所の呼び出しは**一切変えなくてよい**
- 分類ロジック・containment・a11y 属性の 3 つを**複製しない**（#3001 で 5 回もレビュー指摘を受けた領域を、
  もう一つの実装に増やすのは最悪手）

### 名前パターンを共有してよい理由

`resolveIconGlyph` の `/^[a-z0-9_]+$/` は Material **Symbols** 用に実測して決めたものだが、
Material **Icons** の全 2122 名も**charset はちょうど同じ `[0-9_a-z]`**（#3001 で実測済み）。
「リガチャ名の形をしているか」という問いの答えは両フォントで一致する。

ただし `src/utils/role/icon.ts` の `MATERIAL_ICON_RE` は**別のまま残す**。あちらは
「どの名前を `smart_toy` にフォールバックさせるか」を決める**別の判断**で、
それぞれ**自分の出荷済み一覧に対する全件走査**で固定されている（2122 名 / 3896 名）。

## 実装

### 1. `IconGlyph` に `fontClass` を足す（core）
```ts
/** アイコンフォントのクラス。既定は Material Symbols。ロール系は
 *  `material-icons`（別フォント・別の名前一覧）を渡す。 */
fontClass?: string | undefined;
```
symbol 分岐のクラス配列で `"material-symbols-outlined"` の代わりに使う。

### 2. 3 画面を差し替え（host）

サイズを**現状維持**することが重要（`.material-icons` の既定は **24px**）:

| ファイル | 現状 | 渡す size-class |
|---|---|---|
| `src/components/RolesView.vue:149` | クラス無し＝既定 24px | `text-2xl`（24px） |
| `src/plugins/manageRoles/View.vue:149` | 同上 | `text-2xl` |
| `src/plugins/manageRoles/Preview.vue:8` | `style="font-size:12px"` | `text-xs`（12px） |

## テスト

### ユニット（新規）`test/utils/role/test_iconGlyphFont.ts`
`IconGlyph` は Vue の functional component なので、`h()` の結果を直接検査する:
- `fontClass` 未指定 → `material-symbols-outlined`（**既存 12 箇所の後方互換**）
- `fontClass="material-icons"` → そちらが付く
- 絵文字のときは**どちらのフォントクラスも付かない**（プレーン span）

### e2e（新規）`e2e/tests/roles-view-icon.spec.ts`
Settings → Roles を開き、**幾何を測る**:
- 不正な名前のロール行で、アイコン span が**自分の行を押し広げない**
- **絵文字のロールは絵文字のまま描画され、欠けていない**（1em で切らないことの担保）
- 実在名のロールは従来どおり

## 検証

- `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test` → e2e
- **変異テスト**: `fontClass` を無視するように壊すと落ちること、
  containment を外すと e2e が落ちることを確認する
- **既存 12 箇所が変わっていないこと**を e2e（`launcher shortcut` 系 11 件）で確認
