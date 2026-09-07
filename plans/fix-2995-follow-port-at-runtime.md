# fix: proxy 先を実行時にも追従させる (#2995 / #2981 の残差)

## 背景

#2981 で Vite の proxy 先を backend の実 bind ポートへ追従させたが、**追従は起動時点の
1 回だけ**（`vite.config.ts` は起動時に 1 度しか評価されない）。

`yarn dev` の client 側は publish を待つが、予算（既定 60 秒）を超えると要求ポートへ
フォールバックして Vite を起動する。そのあとで backend が walk 先や ephemeral ポートに
着地すると、**Vite は誤ったターゲットのまま固定**される。

回帰ではない（#2981 以前は常に要求ポートを向いていた）が、#2650 の最後の穴。

## 前回の見立ての訂正

#2982 のレビューで私は「実行時差し替えは http-proxy の内部構造依存で脆い」と書いたが、
**読みだけの判断で誤っていた**。Vite 8 が bundle している http-proxy の実装:

```js
this.options = options;
this.web = this.createRightProxy("web")(options);   // 同じ参照を捕捉
...
return (...args) => {
  requestOptions = { ...options, ...args[counter] };   // ★ リクエストごとに読み直す
  for (const e of ["target", "forward"]) if (typeof requestOptions[e] === "string") ...
```

`requestOptions` は**リクエストごとに** `options` を spread して作られ、その `options` は
`proxy.options` と同一参照。つまり `proxy.options.target` を書き換えれば**次のリクエスト
から効く**。内部ハックではなく、per-request に読み直す設計に乗るだけ。

Vite 側も `proxy.web(req, res, {})` と per-request オプションを空で渡すので、ターゲットは
proxy インスタンスの options からしか来ない（＝書き換えが確実に効く）。

## 設計

- `scripts/lib/proxyTargetFollower.ts` — 純粋な判定 + ポーリングの薄い殻。
  「今の公表値を読む」「切り替える」を注入するので、タイマも fs もなしにテストできる。
  切り替えるのは **valid にパースできて、今と違うときだけ**。読めない・消えた・同じ、は
  何もしない（誤って別のサーバへ向けないため）。
- `vite.config.ts` — 各 backend proxy エントリの `configure(proxy)` で proxy インスタンスを
  follower に登録し、`.server-port` の変化で `proxy.options.target` を更新する。
  http と ws でスキームが違うので、エントリごとに正しい origin を作る。
- 追従のゲート（`MULMOCLAUDE_DEV_FOLLOW_PORT=1`）は #2981 のものをそのまま使う。
  `dev:client` 系は実行時にも追従しない。
- waiter のフォールバック文言から「`yarn dev` を再起動して」を落とす（不要になるため）。

## 制約（意図的に対象外）

- **既存の WebSocket 接続は移らない。** 切り替えは次の接続から。pubsub クライアントは
  再接続するので実害は無い見込みだが、PR に明記する。
- ポーリング間隔ぶんの遅延がある（1 秒）。`fs.watch` は Windows で信頼できない
  （`docs/windows-gotchas.md`）ので、小さなファイル 1 つのポーリングを選ぶ。

## 検証

- 単体: follower の判定表（不変 / 変化 / 壊れた値 / 消えた / 同値）
- 統合: **Vite を実際に起動し、`.server-port` を書き換えて proxy 先が移ることを確認する**。
  2 つの fake backend を別ポートに立て、`/api/x` の応答がどちらから来るかで判定する。
  これが「実行時に追従した」の外部 ground truth。
- 実機: 要求ポートを塞いだうえで **publish を意図的に遅らせ**（`MULMOCLAUDE_DEV_WAIT_MS` を
  短くする）、Vite が先に起動してから backend が別ポートに上がる状況を作り、
  ブラウザ経由で 200 が返ることを確認する。
