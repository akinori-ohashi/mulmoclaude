# 設定画面から GEMINI_API_KEY を入れられるようにする (#871 v1)

## なぜ

いま `GEMINI_API_KEY` を渡す唯一の方法は `.env` を自分で作ることで、端末を開かない
ユーザーには「どのディレクトリか」「不可視のドットファイルをどう作るか」が壁になる。
#3231 で案内文は正しくなった（この起動が読む `.env` の絶対パスを名指しする）が、
**入力口が無いこと自体は変わらない**。

#871 の v1 スコープをそのまま実装する: キーは `GEMINI_API_KEY` 1本、保存先は
`~/.mulmoclaude/secrets/GEMINI_API_KEY`、設定画面から入力。

## 決まっていること（#871 とそのコメントで確定済み）

- **保存先** `~/.mulmoclaude/secrets/<KEY>`、パーミッションは 0600、ディレクトリは 0700。
  ワークスペース（`~/mulmoclaude`）には置かない — あそこは agent が管理するデータ空間で、
  秘密の置き場ではない（`launch-env.mjs` の但し書きと同じ理由）
- **優先順位**: 設定画面の値が authoritative。無いときだけシェル / `.env` の環境変数に
  フォールバックする（#871 のコメント、#2604）。「シェルの古い値が GUI の値を黙って
  上書きする」のを避けるのが要点
- **どのソースが効いているかを画面に出す**（同コメント）

## 設計判断（#871 の open question への答え）

- **Q1 更新の反映**: 再起動を要求しない。#871 自身が (c) hybrid で「per-call の秘密は
  live」と書いており、Gemini キーはまさにそれ。保存時に `process.env` も更新し、
  サーバ自身の読み取り（`isGeminiAvailable` / `getGeminiClient`）を live にする。
  **既に動いている子プロセスは古い環境を持ち続ける** — これは明記する
- **秘密を `process.env` に載せる理由**（読むだけにしない理由）: キーを使うのはサーバ
  だけではない。agent が呼ぶ `mulmocast` などの子プロセスは環境変数として受け取る。
  ファイルを読むだけの実装にすると、サーバの画像生成は動くのに動画・音声が動かない、
  という分かれ方をする
- **Q2 Docker**: 変更なし。サーバはホスト側で動き、`server/agent/` は今も
  `GEMINI_API_KEY` をコンテナに渡していない（`grep` で確認）。つまり `.env` 経由でも
  同じ状態で、この PR は差を作らない。v2 の課題として残す
- **Q4 暗号化**: v1 は 0600 のみ（#871 のとおり）。keychain は v3
- **値を API で返さない**: `configured` と「効いているソース」だけ返す。#871 は
  「masked で表示」と書いているが、値をブラウザに戻す必要はない。Maps キーは
  settings.json 経由で全文が返っている（`SettingsMapTab.vue`）ので、そこだけ流儀を
  変えることになる。PR で明示してレビューを仰ぐ

## やること

- `server/system/secrets.ts`（新規）— 保存先・キー許可リスト・値の検証・読み書き。
  検証は純粋関数に分け、制御文字と改行を弾き、長さに上限を置く（`process.env` に
  載る値であり、ログ行にも隣接するため）
- `server/system/loadEnv.ts` — `.env` 適用のあとに GUI の秘密を **上書きで** 適用。
  ここで入れるのは `server/workspace/paths.ts` が module スコープで `process.env` を
  読むより前でなければならないため（既存のコメントが同じ理由を書いている）
- `server/system/env.ts` — Gemini キーだけ live 読み取りにする（凍結 snapshot の例外。
  理由をコメントに書く）
- `server/api/routes/secrets.ts`（新規）+ `src/config/apiRoutes.ts` に経路を追加
- `src/components/SettingsGeminiTab.vue`（新規）— 入力・保存・消去・効いているソースの
  表示。いまの Gemini タブ本文は `SettingsModal.vue` に直書きなので、`SettingsMapTab`
  と同じ形に切り出す
- i18n 8ロケール（`docs/i18n.md` のとおり同一 PR で全部）
- `packages/core/assets/helps/gemini.md` — 設定画面を第一の手段として書き直す
- `docs/developer.md` — 秘密の保存先と優先順位

## 確認

- 単体: 検証・ソース解決・読み書き（一時ディレクトリ、パーミッションも見る）
- e2e: 入力 → 保存 → 「設定済み」表示 → 消去
- 実機: キー無しで起動 → 設定画面から入れる → 再起動なしで画像生成が通る、
  および `/api/health` の `geminiAvailable` が true になる
