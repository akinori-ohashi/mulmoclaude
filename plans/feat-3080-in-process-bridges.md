# feat(bridges): 設定しておけばサーバと一緒にブリッジも起動する (#3080)

`.env` に認証情報を置いて `config/bridges.json` で有効にすれば、**サーバのプロセス内で**
ブリッジが起動する。`yarn telegram` を手で立て直す運用を無くす。

## 決定（issue #3080 のコメントに記録）

| 項目         | 決定                                             |
| ------------ | ------------------------------------------------ |
| C-1 方式     | **案 2 — プロセス内**（Relay と同じ形）          |
| C-2 設定     | 有効/無効は `config/bridges.json`、秘密は `.env` |
| C-3 範囲     | **25 個すべて**                                  |
| C-4 起動失敗 | **サーバの起動は止めない**。ログのみ             |
| C-5 UI       | 後回し（別 issue）                               |

## 測った事実（設計の根拠）

### transport 非依存のコアが既にある

`packages/chat-service/src/relay.ts` は「HTTP (router) と socket.io の両 transport が
呼ぶ共有コア」と自称していて、実際そうなっている:

```ts
export type RelayFn = (params: RelayParams) => Promise<RelayResult>;
```

**プロセス内経路は 3 つ目の呼び出し元**になるだけで、新しいコアは要らない。
`RelayParams.onChunk` が `BridgeClient.onTextChunk` にそのまま対応する。

逆方向は `pushToBridge(transportId, chatId, message)`。`packages/chat-service/src/index.ts:107`
に間接層があり 205 行で socket ハンドルの実装に差し替わる。**ここに in-process の
fan-out を足す**。

### 25 個が使う client の面は 4 メンバだけ

`createBridgeClient` の戻り値へのアクセスを 25 個すべてで数えた:

| メンバ                                  | bridge 数 |
| --------------------------------------- | --------- |
| `send`                                  | 25        |
| `onPush`                                | 25        |
| `onTextChunk`                           | 2         |
| `close`                                 | 1         |
| `onConnect` / `onDisconnect` / `socket` | **0**     |

`socket` エスケープハッチの利用は**ゼロ**。実装すべき面は小さい。

### 本当のコストは index.ts の形

「ブリッジは実質ライブラリ」が当てはまるのは **telegram だけ**。
他の 24 本は `index.ts` が副作用のあるトップレベルスクリプト
（env を読む → 無ければ `process.exit(1)` → ポーリング開始）で、`src` が 1 ファイルの
ものが大半（180〜330 行）。

**作業の本体は「25 個の index.ts を `export async function start(config)` に変換する」こと。**

## 設計

### 1. `@mulmobridge/client` にプロセス内トランスポートを足す

`createBridgeClient({ transportId, transport })` の `transport` が
`{ kind: "socket" }`（既定・現状）か `{ kind: "in-process", relay, registerPush }` を取る。
プロセス内実装は `BridgeClient` を満たすが:

- `send` → `relay({ transportId, externalChatId, text, attachments, bridgeOptions, onChunk })`
- `onPush` → `registerPush(transportId, handler)` で server 側の fan-out に登録
- `onTextChunk` → `send` に渡す `onChunk` へ配線
- `close` → 登録解除
- `onConnect` / `onDisconnect` → 即時 connect 扱い（プロセス内に切断は無い）
- `socket` → **アクセスしたら throw**。25 個のうち誰も触っていないことを測ってある。
  黙って null を返すと、将来触った人が undefined 経由の実行時エラーで気づくことになる

### 2. 各 bridge に `start()` を生やす

`packages/bridges/<name>/src/index.ts` を 2 つに割る:

- `src/start.ts` — `export async function start(deps: BridgeStartDeps): Promise<BridgeHandle>`。
  env ではなく**引数**で設定を受け取り、`process.exit` を呼ばず**throw する**
- `src/index.ts` — 従来どおりの CLI。env を読んで `start()` を呼び、失敗したら
  今までどおり `console.error` + `exit(1)`。**CLI の挙動は 1 バイトも変えない**

これで `yarn telegram` の経路は現状維持のまま、プロセス内からも起動できる。

### 3. サーバ側の登録簿

- `config/bridges.json`: `{ "bridges": { "telegram": { "enabled": true }, ... } }`
  （`config/scheduler/tasks.json` の `enabled` フラグが前例）
- `server/bridges/registry.ts`: 有効な bridge を読み、`start()` を呼び、handle を保持
- `attachTransports()` に 1 ブロック追加（Relay の隣）
- **エラー隔離**: 1 本の起動失敗・例外が他や本体を巻き込まない。`start()` は個別に
  try/catch し、失敗はログのみでサーバは上がる（C-4）
- シャットダウン時は保持した handle を順に `close()`

## 検証すること

- **CLI 経路が 1 バイトも変わらないこと**: `yarn telegram` の起動ログ・エラー文言・exit code を
  変更前後で比較する（`/refactor-safely`）
- 1 本の bridge が throw しても他が動き続け、サーバが落ちないこと（意図的に壊して確認）
- プロセス内 bridge へ push が届くこと（socket.io 経路と両方 live なときも含む）
- `config/bridges.json` が無い / 壊れている / 未知の名前が入っているときにサーバが上がること
- `socket` アクセスが throw すること

## やらないこと

- **UI**（C-5）。別 issue
- **#3078 の解消**: プロセス内経路では構造的に起きなくなるが、手動 `yarn telegram` は残るので
  #3078 自体は別途必要
- Relay 経路の変更。既に動いているものには触らない

## 進め方（PR を分ける）

1. **PR-1**: client のプロセス内トランスポート + telegram の `start()` 分割 + サーバ登録簿 +
   `config/bridges.json`。**telegram 1 本で経路を通す**
2. **PR-2 以降**: 残り 24 本の `start()` 分割。機械的な変換なので数本ずつ束ねる

25 本を 1 つの PR に入れない。1 本目で設計を検証してから横展開する。
