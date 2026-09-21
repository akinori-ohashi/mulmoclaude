# fix(collection-plugin): レコードの「チャット」で詳細モーダルを閉じる

Issue: receptron/mulmoclaude#3220

## 症状

レコード詳細の「このレコードについてチャット」から送信しても詳細モーダルが残る。
モーダルは `fixed inset-0 z-40` の全画面オーバーレイなので、始まったばかりの
チャットはその裏に隠れる。テキストエリアが空になるだけで、押せたかどうかも
分からない。

同じプラグインのヘッダ側「コレクションについてチャット」は送信時に自分を閉じて
いる。レコード側だけが非対称。

## 原因

`packages/plugins/collection-plugin/src/vue/composables/useCollectionChat.ts`

- `submitChat()` … `closeChat()` してから `dispatchSeed()`
- `onItemChat()` … `dispatchSeed()` のみ。詳細を閉じる処理が無い

`viewing.value = null` とするだけでは足りない。スタンドアロンでは `?selected=<id>`
が残り route watcher（`syncViewToSelected`）が即座に開き直す。埋め込みでは
`emit("select", null)` を出さないとカードの `viewState` が古いままになる。
どちらも `CollectionView.vue` の `closeView()` が面倒を見ている。

## 隠すオーバーレイは2つある

issue は詳細モーダルだけを挙げているが、同じチャットボックスは
`CollectionDayView`（カレンダーの日ポップアップ）の `#detail` スロットにも
置かれている。そちらも `fixed inset-0 z-40` なので、詳細だけ閉じても日ポップアップ
が残ってチャットを覆う。閉じる対象は「開いているレコードを載せている全画面の面」
すべて。

## 方針（issue の案A）

`useCollectionChat` に `closeRecord: () => void` を受け取らせ、`onItemChat` が
seed を組み立てた **あと** に呼ぶ（`viewing` を読んでから閉じる）。ホスト側の
`CollectionView.vue` は `closeRecordSurfaces()` を渡す — 日ポップアップ（`openDay`）と
編集中の下書き（`editing`）と詳細（`closeView`）をまとめて落とす関数で、既存の
`onDayClose()` の中身そのもの。`onDayClose()` は別名なので消し、テンプレートの
`@close` も `closeRecordSurfaces` を直接呼ぶ。

案B（開いたままトースト＋導線）は採らない。全画面モーダルが残る限りチャット自体
は裏に隠れたままで、症状の本体が消えない。

## 変更

1. `useCollectionChat.ts` — `UseCollectionChatParams` に `closeRecord` を追加。
   `onItemChat` を「seed を組む → `closeRecord()` → `dispatchSeed()`」の順に。
   `submitChat` の close→dispatch と同じ形。
2. `CollectionView.vue` — `onDayClose()` を `closeRecordSurfaces()` に改名し
   （テンプレートの `@close` も差し替え）、`useCollectionChat` へ
   `closeRecord: closeRecordSurfaces` を渡す。
3. `test/plugins/collection/test_useCollectionChat.ts`（新規）— composable を
   直接叩く単体テスト。onItemChat が seed を組んでから閉じること、空文字・
   コレクション未読み込み・レコード未選択では閉じないこと、ヘッダ側 `submitChat`
   は詳細に触らないこと。
4. `e2e/tests/present-collection.spec.ts` — 埋め込み（チャットカード）で
   詳細モーダルが実際に消えることを見る。スタンドアロンは `/chat` へ遷移して
   どのみちモーダルごと消えるので、「閉じたのは修正のおかげ」と言えるのは
   この面だけ。
5. `e2e/tests/collection-chat-button.spec.ts` — スタンドアロンの方も一本。
   `?selected=` を落とす `router.replace` と新規チャットの `router.push` が
   同じ tick に並ぶので、seed が `id=<record>` を保ったまま `/chat` に着くことを
   見ておく。

## 確認

- 単体テストは fix 前のコードに当てると該当の4本が赤くなることを確認済み。
  `viewing` を close の **後** に読む変異も赤くなる（seed から `id=` が落ちる）。
- e2e も同じく差分で確認。plugin は `dist/` 経由で host に入るので、
  fix を戻したあと `vite build` を回し直さないと「直っていない状態」を
  観測できない点に注意（最初これで素通りした）。
- `yarn format` / `yarn typecheck` / `yarn lint` / `yarn build` / `yarn test`
