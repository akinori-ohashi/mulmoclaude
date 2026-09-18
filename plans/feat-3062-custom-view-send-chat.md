# feat(collections): カスタムビューのボタンから下書きではなく即送信する（#3062）

## Goal

カスタムビュー内のボタンが `__MC_VIEW.startChat(prompt)` を呼んだとき、現状は必ず
**下書き**（composer に置くだけ）になる。issue #3062 は「押した時点で走る」ことを求めている。

`views[]` の宣言に `allowSendChat: true` を足し、**宣言したビューに限り** `startChat` を
即送信に切り替える。

## 現状（コードで確認済み）

- `CollectionView.vue` の `onCustomViewStartChat` が無条件で `cui.startNewChatDraft` を呼ぶ。
  ここが唯一の固定点で、ホスト側の能力 (`cui.startChat` = 即送信) は両ホストに既にある。
- 「下書きゲート」が実質的に効いているのは MulmoClaude アプリの composer だけ:
  - MulmoTerminal デスクトップ: `server/session/pty-text.ts` の `sanitizeDraftText` が
    `\s+ → " "` で1行に潰してから bracketed paste するので、入力欄で内容を読めない。
  - スマホ (`target: "mobile"`): MulmoClaude は `server/remoteHost/handlers/startChat.ts` が
    「seeded VERBATIM as the first user turn」、MulmoTerminal は `remoteHostSpawnChat` →
    `spawnClaudePty(..., { initialPrompt })`。どちらも**常に送信**。
- したがって「ビューのボタン → ターンが走る」は既に一面で出荷済み。この変更は
  デスクトップに**宣言つきの**同じ経路を開くもので、スマホより厳しいゲートが付く。

## なぜ宣言フラグか

- **後方互換が必須**。宣言も引数も無しに即送信へ倒すと、ホストを上げた瞬間に既存の全
  カスタムビューの `startChat` が黙って送信に変わる。
- `CollectionCustomView.vue` には `props.view`（`CustomViewZ` そのもの）が既に渡っている。
  判定はホストが取得した schema 側で行うので、iframe からは偽造できない。
  `capabilities` / `editableFields` / `allowDelete` と同じ棚。
- ビュー側 API（`startChat` の第3引数など）を増やす案は bootstrap の写し3枚
  （`src/utils/html/customViewSrcdoc.ts` / `packages/core/src/remote-view/index.ts` /
  `receptron/mulmoterminal` の `src/utils/customViewSrcdoc.ts`）と
  `REMOTE_VIEW_PROTOCOL` bump、そして別リポの companion PR を要求する。
  宣言フラグなら bootstrap も protocol も触らずに済む。
- トレードオフ: 粒度がビュー単位になる（そのビューの `startChat` が全部送信になる）。
  ボタン単位が要るなら、後から `{ send: true }` を上位互換で足せる。

## 変更点

1. `packages/core/src/collection/core/schemaZ.ts` — `CustomViewZ` に
   `allowSendChat: z.boolean().optional()`。既定は不在＝下書き（least privilege）。
   型は `z.infer` 経由なので `CollectionCustomView` に自動で乗る。
2. `CollectionCustomView.vue` — `startChat` emit の payload に `send` を足す。
   値は `props.view.allowSendChat === true`（ビューが送ってくる値ではなく宣言を見る）。
3. `CollectionRemoteViewPreview.vue` — 同じ宣言を同じように反映。
4. `CollectionView.vue` の `onCustomViewStartChat` — `send` で
   `cui.startChat(prompt, role)` / `cui.startNewChatDraft(prompt, role)` を分岐。
   `cui.startChat` は `role: string` 必須なので、未指定時は `cui.generalRoleId`。
5. ドキュメント — `packages/core/assets/helps/custom-view.md` /
   `custom-view-remote.md` / `collection-skills.md`。
   「does **not** send」という現行の断定を、面ごとの実態に合わせて書き直す
   （スマホは常に送信、という事実を明記）。
6. テスト — schema の受理、`onCustomViewStartChat` の分岐。

## スコープ外（このPRではやらない）

- **スマホ実機は `allowSendChat` を見ない**（従来どおり常に送信）。挙動を変えるには
  ホスト側の remote-host handler を触る必要があり、`receptron/mulmoterminal#1253`
  （スマホには Enter が無いので下書きだと作業が止まる）の判断をひっくり返す話になる。
  ここは実態をドキュメントに書くに留め、揃えるかどうかは follow-up の判断に回す。
- issue の案A（宣言済みアクションをビューから id + params で呼ぶ）。命令文を
  `templates/*.md` に固定できてプロンプト的には一番堅いが、`SeededActionZ` への
  `params` 追加・シードへの params 注入・ビュー→ホストのアクション呼び出し口・
  protocol bump が要る別機能の規模。

## 検証

- `yarn format` → `yarn build:packages` → `yarn typecheck` → `yarn lint` → `yarn build` → `yarn test`
- **デスクトップのカスタムビュー**（と、同じ宣言に従う phone-frame preview）:
  宣言のあるビューはボタンでターンが走り、宣言の無いビューは下書きで止まること。
  e2e (`e2e/tests/collection-custom-view-send-chat.spec.ts`) が実際の sandboxed iframe と
  postMessage bridge を通して両方向を押さえる。
- **スマホ実機**: ここは `allowSendChat` を見ずに**常に送信**なので、「宣言が無ければ下書き」は
  成立しない。実機で確認するのは「宣言の有無にかかわらず送信されること」＝従来どおり変わって
  いないこと。
