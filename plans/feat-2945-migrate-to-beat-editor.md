# feat: mulmoscript-plugin を @mulmocast/beat-editor へ移行 (#2945)

## なぜ

`@mulmocast/deck-web` は `@mulmocast/beat-editor` へのリネームとして npm 上で deprecated だが、
**同じコンポーネントは残っていない**。plugin が使っている `MulmoScriptDeckEditor` は
iframe エディタごと削除されている。素直なリネームでは移行できない。

移行に必要なホスト統合面の機能は beat-editor 1.1.0 で揃った。

## 変更点（5ファイル + スタイル1行）

| ファイル | 変更 |
|---|---|
| `package.json` | peer を `@mulmocast/beat-editor: ^1.1.0` へ。version 3.1.0 → **4.0.0**（peer の変更は破壊的） |
| `vite.config.ts` | `external` の指定を差し替え |
| `src/vue/viewTypes.ts` | `SlideLayout` / `SlideTheme` の import 元（beat-editor が同名で re-export） |
| `src/vue/View.vue` | 動的 import を `BeatListEditor` へ。テンプレートを beats 受け渡しへ |
| `src/vue/index.ts` | `@mulmocast/beat-editor/style.css` を import（下記） |

`src/vue/composables/useDeckEditor.ts`（69行、300ms デバウンス）は **script 単位のまま変更不要**。
変換は View.vue 側で `beatsOf` / `withBeats` を挟むだけ。

## API 対応

| deck-web | beat-editor |
|---|---|
| `:script="deckScriptInput"` | `:beats="beatsOf(deckScriptInput)"` |
| `@update:script="onDeckUpdate"` | `@update:beats` → `withBeats(script, beats)` して `onDeckUpdate` |
| `layout="compact"` | prop 廃止。コンテナクエリで自動、幅は `--beat-editor-pane-width` |

`withBeats` を使うのは、`{ ...script, beats }` を手書きすると `presentationStyle` /
`slideParams` を落とす事故が起きるため。

## スタイルシート — 移行で直る既存バグ

移行前の実測で、**現状のデッキエディタは必要な CSS が当たっていない**ことが分かった。
`w-56` / `w-96` / `min-h-0` / `overflow-auto` / `border-r` / `bg-gray-100` / `px-8` は
plugin の `dist/style.css` に定義が無く、`@mulmocast/deck-web/style.css` を
import している箇所もどこにも無い。

原因は Tailwind v4 が**そのパッケージ自身のソースしかスキャンしない**こと。
ホスト（mulmoterminal）の `plugin-tailwind.css` も `@mulmochat-plugin/*` の dist しか
`@source` していない。同じ失敗がそのファイルのコメントに既に記録されている。

→ **plugin が `@mulmocast/beat-editor/style.css` を import する**。plugin は複数のホストに
載りうるので、ホストごとに `@source` を足す運用は同じ見落としを生む。

## 検証

1. `yarn build` / `lint` / `typecheck` / `test`
2. **ビルド成果物に beat-editor のクラスが入っていること**を実測で確認
   （移行前に欠けていた `w-96` などが `dist/style.css` に出るか）
3. 実機: mulmoterminal に載せて、全 beat が slide のスクリプトでデッキ編集が動くか

## 順序

plugin 4.0.0 を先に出す。mulmoterminal はそのあと plugin を上げ、
自分の `@mulmocast/deck-web` 依存を `@mulmocast/beat-editor` に差し替える（別 PR）。
逆順にすると plugin のデッキ編集が壊れる。

## デモハーネス（このPRで追加）

`yarn dev` で plugin 単体を Vite で起動できるようにした（`index.html` + `demo/`）。
GUIChatPlugins 側の各 plugin と同じ形。**このモノレポの plugin では初**。

移行の2つの疑問（コンテナクエリでの幅対応 / Shadow DOM へのスタイル到達）は
コードを読んでも答えが出ず、ホストを丸ごと起動するのは重い。デモはその中間。

- `demo/runtimeStub.ts` — `BrowserPluginRuntime` のスタブ。mulmoscript を知らないので、
  他 plugin へデモを広げるときの共通ハーネスになる
- `demo/ShadowFrame.vue` — ホストと同じ Shadow DOM 条件。`provide`/`inject` は
  コンポーネント階層で解決されるため、slot を別ツリーへ描き直すと連鎖が切れる。
  よって shadow 側は**独立した Vue アプリ**として mount し、そこに runtime を install する
  （ホストが plugin ごとに行うのと同じ）
- 幅と Shadow DOM の2トグル

### デモで実測できたこと

| | Shadow DOM 内 | 通常 DOM |
|---|---|---|
| スライドの背景 / テーマ変数 | `#F8FAFC` ✓ | `#F8FAFC` ✓ |
| item の `cursor` | **`auto`**（効かない） | `grab` ✓ |

**スライド本体のスタイルは Shadow DOM でも効く** — beat-editor はテーマ変数をスライド要素に
インラインで出すため。届かないのは `ensureDocumentStyles` が `document.head` に注入する
**編集アフォーダンス**（grab カーソル / hover の outline / 編集中の outline）だけ。
