# fix: カスタムビューが名乗った役割を、使う前に検証する (#3267)

## Request

「3267やって」

## 何が起きているか（自分で辿って確認した）

サンドボックス内のビューが `__MC_VIEW.startChat(prompt, role)` を呼ぶと、`role` は文字列ならそのまま
ホストへ渡る（`CollectionCustomView.vue` の `handleStartChat` と `mc-start-chat` の受け口）。受け口が経路によって非対称だった:

- 送信（`CollectionView.vue` の `onCustomViewStartChat`）: `cui.startChat(prompt, payload.role ?? cui.generalRoleId)`。
  `??` は「無い」ときにしか既定へ落ちないので、**渡された id がそのまま通る**
- 下書き（同じ関数の else 側）: `App.vue` の `startNewChatDraft` が `roles` と照合して、無ければ General に落とす

送信側の下流にも照合は無い（`App.vue` の `startNewChat` → `sessionLifecycle.ts` の
`explicitRoleId ?? (...)`）。

**牙は「存在しない id」ではなく debug の役割の方**。存在しない id は、セッションの役割を
解決する側（`App.vue` の `roleOfSession`）が一覧に無いものを既定へ落とすので、実際に走る
assistant は変わらない（見出しの表示が名乗ったままになる、という誤表示に留まる）。一方
`debug` は**実在する役割**で、`manageDebug` を持ち、送信・下書きの両方に通っていた。

## 存在確認だけでは足りない

ホスト側の同じ判断（`server/remoteHost/handlers/startChat.ts` の `resolveRoleId`）は
**「存在し、かつ debug でない」**を要求して拒否している。ブラウザ側の `roles` には debug の役割も
入っていて、選択欄が描画時に隠しているだけ（`RoleSelector.vue` の絞り込み）。つまり下書き側の既存の照合も、
debug の役割は通してしまう。

## 直す場所

**プラグインから呼ばれるホスト側の入口**に置く。プラグイン側の `cui` は役割一覧を持っていないので、
そこでは判定できない。利用者自身の「＋」ボタンは `createNewSession` を直接呼ぶ別経路なので、
開発モードで debug の役割を選ぶ操作は壊れない。

- `src/utils/session/roleSelection.ts`（新規・純粋関数）: 渡された id が honour できるなら返し、
  できなければ `undefined` を返す。判定はホスト側と同じ「存在し、かつ debug でない」
- `App.vue` の `startNewChat` と `startNewChatDraft` が、渡す前にこれを通す

**既定値は入口ごとに違うので、そこは変えない**。`startNewChat` は id が無ければ選択中の役割
（`App.vue:480-485` に意図が書かれている）、下書きは General。関数が `undefined` を返すことで、
それぞれの既定がそのまま効く。

## やらないこと（理由を測った見送り）

`resolveNewSessionRoleId` は渡された id を検証しないままにする。

- 今回の修正後、ここに未検証の id を渡す経路は**利用者自身の「＋」ボタンだけ**になる。選択欄が
  見せた役割を選んでいるので、サンドボックス由来の値は来ない
- ここで debug を弾くと、開発モードで debug の役割を選ぶ操作が壊れる。存在確認だけを足すことは
  できるが、それは既存テストが明示的に固定している挙動（未知の id を素通しする）の変更になり、
  この issue の欠陥とは別の判断が要る

## テスト

- `test/utils/session/test_roleSelection.ts`（新規）: 正常系と異常系の両方向。存在する役割・未知の
  id・debug の役割・空文字（空 id を持つ役割が一覧にある場合も）・`undefined`・役割一覧が空
- **入口が実際にこの関数を通していること**は `e2e/tests/collection-custom-view-send-chat.spec.ts`
  に足す。実物のサンドボックスから `startChat(prompt, 'debug')` を投げ、記録された
  `POST /api/agent` の本文の `roleId` がそれでないことを見る。起動時は選択中の役割が既定と
  同じなので、肯定形では「拒否された」と「たまたま一致した」を区別できない。否定形で書く
