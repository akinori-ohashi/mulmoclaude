# fix(collections): Canvas のカードがカスタムビューの選択を保存できない (#3061)

## 症状

`presentCollection` カードでカスタムビューを選び、セッションを選び直すとテーブルビューに戻る。
calendar / kanban は残るのにカスタムビューだけ落ちる。

## 原因

カードの復元状態 `viewState.view` が built-in 3種 (`table` / `calendar` / `kanban`) に narrow されている。

1. `components/CollectionView.vue` — `viewStateChange` の emit 型が `BuiltInViewMode`、
   emit 時に `builtInViewOrTable(activeView.value)` を通すので `custom:<id>` が `"table"` に潰れる
2. `chat/View.vue` — `PresentCollectionViewState.view` の型と `toViewState` の validator が
   built-in 3種のみ。`onViewStateChange` の引数型も同じ

「保存されない」だけでなく一段悪い: 監視対象に `loading` が入っているのでカードはロード完了時に
自分で `viewState.view = "table"` を書き、その `initialView` は slug の localStorage 設定より
優先される (`composables/useViewMode.ts:49-52`)。標準ページで `custom:<id>` を選んであっても
カードはそれを上書きし続ける。

読む側 (`:initial-view` → `useViewMode`) は既に `CollectionViewMode` を受け、未知の custom id は
`resolveActiveViewMode` が `table` へ落とすので、widen しても stale な値は安全。

## 方針

`viewState.view` を `CollectionViewMode` に widen する。

1. `collectionViewMode.ts`
   - private の `isValidViewMode` を `isCollectionViewMode` として export
     (localStorage の reader とカードの validator が同じ判定を共有する — DRY)
   - `builtInViewOrTable` を削除。widen 後に参照元が無くなる
2. `composables/useViewMode.ts` — `builtInViewOrTable` の再エクスポートを外す
3. `components/CollectionView.vue` — emit 型を `CollectionViewMode` に広げ、`activeView.value` を
   そのまま emit
4. `chat/View.vue` — `toViewState` を `chat/presentCollectionViewState.ts` へ純関数として切り出し
   (`presentCollectionData.ts` と同じ形)。`view` の型を `CollectionViewMode` に広げ、
   validator は `isCollectionViewMode` を使う

## テスト

- `test/plugins/collection/test_presentCollectionViewState.ts` (新規) — `toViewState` の正常系/異常系:
  `custom:<id>` を通す、built-in を通す、未知の文字列 / 数値 / null / 配列を落とす、
  宣言されていないキーを持ち込まない、`selected: null` を保持する
- `test/plugins/collection/test_collectionViewMode.ts` — `builtInViewOrTable` の describe を
  `isCollectionViewMode` に差し替え
- 回帰の証明: fix を revert したら新しい `custom:` のテストが赤になることを確認する

## Out of scope

- ロード窓での transient な emit (`loading` が dependency なので、スキーマ解決前に一度
  `table` が emit され、解決後に正しい値で上書きされる)。calendar / kanban も同じ経路で、
  この issue で変わるものではない
- npm への publish (`@mulmoclaude/collection-plugin`)。MulmoTerminal 側に届けるには
  別途リリースが必要
