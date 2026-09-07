# fix: dev 起動時に backend 未 ready を正しく扱う (#2975)

## 症状

Windows 11 で `yarn dev` の初回起動時、ブラウザに **`Bad Gateway`** が出る。
報告者の環境は Windows 11 / Vite 8.2.0 / Chrome。

## 原因（再現確認済み）

Windows 固有ではなく、**Vite の dev proxy を挟むと必ず起きる**種類のバグ。
Windows は backend の cold start が遅く、固定待ち 2 秒を超えやすいので踏みやすいだけ。

### 1. proxy の 502 が「バックエンド到達不能」として扱われていない（画面に出る文字列の正体）

backend 未起動のまま Vite 単体に投げて実測:

```
$ curl -i http://127.0.0.1:45999/api/health   # backend なし
HTTP/1.1 502 Bad Gateway
Content-Type: text/plain
（ボディ空）
```

Vite 8 は proxy の ECONNREFUSED を `res.writeHead(502, ...).end()` で返す
(`node_modules/vite/dist/node/chunks/node.js:19148`)。ここから:

- `src/utils/api.ts` — **レスポンスが返った時点で `backendReachable` を `true` に再アーム**して
  しまう。offline と見なすのは `fetch` が throw した場合（`status: 0`）だけ。
- `extractError` — ボディが JSON でないので `res.statusText` をそのままエラー文言にする。
  → **これが「Bad Gateway」**。

結果、`BackendOfflineBanner.vue`（「バックエンドに接続できません」＋再試行ボタン）という
**正しい UI が既にあるのに dev では絶対に出ない**。本番（`npx mulmoclaude`、proxy 無し）は
`fetch` が throw するのでバナーが出る。dev だけ proxy が例外を HTTP 応答へ変換して殺している。

### 2. 固定 2 秒待ちと、そこに乗っている認証トークンの窓

`package.json` の `dev` は `yarn sleep && vite`＝**固定 2000ms**。
`vite.config.ts` の `mulmoclaudeAuthTokenPlugin` は index.html を返すたびに `.session-token` を
読んで埋め込む。このファイルは **graceful shutdown で削除される**（`server/api/auth/token.ts`）ので、
サーバが書き直す前にページを開くと **空トークンが焼き込まれ、以後すべて 401**。
502 の方は 15 秒の health poll で自然回復するが、**こちらはリロードするまで回復しない**。

**両者を一度に消せる根拠**: `server/index.ts` は `generateAndWriteToken` を
`app.listen` の**前に await している**（1374 行 → 1475 行、分岐なしの直列 async IIFE）。
つまり **「ポートが accept する ⇒ トークンは書き終わっている」** が成り立つので、
ポートの readiness を待てば 502 と 401 の両方が閉じる。

## 対応

### A. クライアント: ボディなしの gateway 応答を「到達不能」として扱う

`src/utils/api.ts`:

- `extractError` が「アプリ自身の JSON `{ error }` ボディだったか」を返すようにする。
- **502 / 503 / 504 かつ アプリの JSON エラーボディ無し** のときだけ `backendReachable` を
  `false` にし、`lastBackendError` に短い技術的説明を入れる（再アームしない）。
- それ以外の 4xx/5xx は従来どおり `backendReachable = true`。

**誤爆しない根拠**: アプリ自身が 502 を返す箇所は `server/api/routes/skills.ts:289` の
external install 失敗だけで、**必ず JSON `{ error }` ボディを伴う**。
503 / 504 はサーバ側・パッケージ側とも**どこにも存在しない**（grep 確認済み）。
判別子はボディの有無なので、`extractError` が既に JSON を先に試している構造に自然に乗る。

これで dev でも「バックエンドに接続できません／再試行」バナーが出て、
15 秒 poll か再試行ボタンで自動復帰する。

### B. 起動: 固定 2 秒を backend の readiness 待ちに置き換える

- `scripts/lib/waitForPort.ts` — 純粋な待機ポリシー。`probe` / `now` / `sleep` を注入する形で
  ソケット無しに単体テストできる。
- `scripts/wait-for-backend.ts` — CLI 薄皮。ポートは **`resolveServerPort` を再利用**する
  （`vite.config.ts` と同じ入力・同じ規則。ここで PORT の解釈を書き直すのは #2650 の再発）。
  127.0.0.1:port へ TCP connect を繰り返し、成功で exit 0。
- `package.json` の `dev` / `dev:debug` / `dev:full-build` の `yarn sleep` を `yarn wait:backend` へ。

**設計上の制約（意図的にこうする）**

- **上限つき**（既定 60s、`MULMOCLAUDE_DEV_WAIT_MS` で変更可）。超えたら理由を出して
  **Vite は起動する**（＝今日の挙動に戻るだけで、悪化しない）。
- `PORT=0` 等でポートが不定のときは**待たずに即 exit**。`assertProxyablePort` が
  Vite 側で明示的に落とすので、待ちで黙って固まらせない。
- backend が別ポートへ歩いた場合（#2650）でも、3001 には最初のインスタンスが listen して
  いるので probe は即成功する。待ちが張り付くシナリオにはならない。
- 数秒ごとに待機中である旨を出す（無言で止まって見えないように）。

## テスト

- `test/utils/test_api.ts` に追加:
  - ボディなし 502 → `backendReachable === false`、`status` は 502 のまま
  - **JSON `{ error }` ボディ付き 502（skills.ts の実物と同じ形）→ `backendReachable === true`**（誤爆しない証明）
  - 503 / 504 も同様にボディなしで false
  - 既存の「JSON ボディ付き 500 で true に戻る」テストは**変更不要**（そのまま通る）
- `test/scripts/test_waitForPort.ts`: 即 ready / N 回目で ready / タイムアウト / probe の呼び出し回数

## やらないこと

- 空トークンで焼き込まれた場合のクライアント側リカバリ（B で窓が閉じるので不要。
  それでも残るのは「backend が 60s 以内に上がらない」場合のみ）
- `.session-token` を graceful shutdown で消さない、という変更（セキュリティ判断なので別件）
