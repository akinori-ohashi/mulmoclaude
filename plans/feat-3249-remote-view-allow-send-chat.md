# feat(remote-host): スマホの remote view で `allowSendChat` を尊重する (#3249)

## Request

#3249（報告者 @shinsuchi）。#3062 で入った `views[]` の `allowSendChat: true` が、
スマホ（mulmoserver.web.app）で開いた `target: "mobile"` のビューでは効かず、
ボタンを押しても入力画面（下書き）で止まる。PC では期待どおり送信される。

ユーザー判断: **案 B（`allowSendChat` を載せてスマホが尊重する）で、ホストとスマホの両方をやる。**

## 検証（報告を鵜呑みにせず自分で辿った）

報告の3点はすべて事実だった:

1. `server/workspace/collections/remoteView.ts:89` が返すのは
   `{ id, label, icon?, target: "mobile" }` だけ。型 `RemoteViewInfo` にも
   `allowSendChat` が無い。`getRemoteView.ts` は `view` をそのまま透過するので、
   スマホは知りようがない
2. `customViewSendsChat()` の呼び出し元は `CollectionCustomView.vue` と
   `CollectionRemoteViewPreview.vue` の2つだけ（どちらも PC）。remote-host 経路に無い
3. コメントと実機の挙動が食い違う

## 報告に無かった発見 — これは載せ忘れではなく設計の分岐

コードは2箇所で「**スマホは常に送信する**」を意図的な設計として明記している:

- `packages/core/src/collection/core/viewChatPolicy.ts` —
  「The phone runtime does not consult this: it always sends, because a phone has
  no Enter key for the user to press (receptron/mulmoterminal#1253).」
- `packages/core/src/remote-view/index.ts` — 同趣旨が2箇所

つまり `allowSendChat` が payload に無いのは意図どおりで、欠けているのは
「スマホは常に送る」というスマホアプリ側の実装。観測された「下書きで止まる」は
**アプリがホストの契約と逆のことをしている**状態。

案 B を採ると **#1253 の判断（Enter キーが無いから常に送る）を覆す**ことになるので、
上記2箇所のコメントは同時に直さないと嘘になる。次に読む人が案 A を実装してしまう。

## 追加調査で分かったこと — ホスト側の変更は不要だった

報告は「`getRemoteView` の payload が `allowSendChat` を落とす」で、**その payload については事実**。
しかしスマホの `activeView` は payload から来ていない:

- `src/composables/useCollectionViews.ts` — `customViews = remoteViews(data.schema.value)`、
  `activeView = customViews.find(...)`。つまり出どころは **コレクションの schema**
- ホストの `getCollection` → `toDetail`（`packages/core/src/collection/server/discovery.ts:323`）は
  `{ ...toSummary(collection), schema: collection.schema }` と **schema を丸ごと**返す
- スマホ側に zod などの検証・剥がしは無い（`useCollection.ts` は型注釈だけ）

よって **`allowSendChat` は既にスマホの手元にある**。欠けているのは読んで従う処理だけ。

一度ホスト側に `RemoteViewInfo.allowSendChat` を足したが、**誰も読まないフィールド**になるので
revert した。payload 版と schema 版の二重の真実を作らない方がよい。

## やること（この repo）

コメントの修正のみ。`allowSendChat` を尊重するのはスマホも同じになるので、
「スマホは常に送る」と書いた2ファイル3箇所が嘘になる:

- `packages/core/src/collection/core/viewChatPolicy.ts`
- `packages/core/src/remote-view/index.ts`（2箇所）

コードは変わらないが、**残すと次に読む人が案 A を実装してしまう**ので直す。

## やること（`mulmoserver` = スマホ側。修正の本体）

1. `src/firestore/collectionSchema.ts` の `CollectionViewSpec` に `allowSendChat?: boolean`
2. `src/views/Collection.vue` の `onRemoteStartChat` で、`activeView.allowSendChat === true` なら
   下書きを開かず送信する
3. 送る文面は下書き経路と**同一**にする（`/<slug> <prompt>`）。ずれると
   「押すと送られる」と「開いて送る」で内容が変わる

## 互換性

宣言していないビューは従来どおり下書き（default-deny）。古いホストに繋いだ場合も
`allowSendChat` が来ないので下書きに倒れる。
