# GEMINI_API_KEY の案内文を、起動経路の実態に合わせる (#2626 の選択肢 (c))

## いま何が嘘になっているか

#2626 の原因1（アイコン起動の cwd が `/`）は #2621 で解消し、アイコン起動が読む
`.env` は `~/.env` になった。README は直したが、**キーが無いときにユーザーが実際に
読む案内文は3か所とも直っていない**。

1. `server/system/announceGeminiKey.ts` — 「MulmoClaude を起動したディレクトリの
   `.env` に置け、または起動前に export しろ」。アイコン起動には起動ディレクトリが
   無く、シェルの `export` は届かない（`resolve-path.sh` が回収するのは PATH だけ）。
2. `src/lang/*.ts` の `settingsModal.geminiRequired` — 置き場所を書いておらず、ただ
   `.env`。設定 → Gemini タブに出る唯一の案内がこれ。
3. `packages/core/assets/helps/gemini.md` — 「`npx mulmoclaude` を実行した
   ディレクトリ」「シェルで `export` してもよい」。**この文書は設定 → Gemini タブの
   「Claude に質問」ボタンで agent が読む**ので、アイコン起動のユーザーが質問すると
   確実に間違った手順が返る。単に古いのではなく、読んだ人を誤った操作に導く。

## 方針

案内文に「起動経路はこうだろう」と書くのをやめ、**実際に読んだ `.env` の絶対パス**を
名指しする。経路を推測する必要がなくなり、アイコン起動でも端末起動でも同じ文で正しい。

経路を知っているのは起動側だけなので、2つの受け渡しを足す。

- `MULMOCLAUDE_LAUNCH_ENV_PATH` — `bin/mulmoclaude.js` が実際に読んだ `.env` の絶対
  パス。存在しなくても設定する（「ここに置け」と言うのが目的なので）。
  これが無いとき（`yarn dev` のような直接起動）はサーバ自身の cwd から組み立てる ——
  `server/system/loadEnv.ts` が読むのと同じ場所になる。
- `MULMOCLAUDE_LAUNCHED_FROM=icon` — アイコンの起動器（`start.mjs`）が付ける印。
  これが付いているときだけ「シェルの `export` は届かない」と書き、付いていないときは
  従来どおり export も案内する。

判断は純粋関数 1 本に閉じ込める（`server/system/geminiKeyGuidance.ts`）。ログ・UI・
文書の3面が同じ facts を読む。

## やること

- `server/utils/launcher/start.mjs`: spawn に渡す環境を作る純粋関数を切り出し、印を付ける
- `packages/mulmoclaude/bin/mulmoclaude.js`: 読んだ `.env` のパスをサーバへ渡す
- `server/system/env.ts`: 受け取り口を snapshot に追加
- `server/system/geminiKeyGuidance.ts`（新規）: facts → 案内文
- `server/system/announceGeminiKey.ts`: その文を使う
- `server/index.ts` の `/api/health`: `.env` の絶対パスを返す
- `src/composables/useHealth.ts` → `src/App.vue` → `src/components/SettingsModal.vue`:
  既にある `{envFile}` 差し込み口に、`.env` ではなく絶対パスを渡す（i18n のキーは不変）
- `packages/core/assets/helps/gemini.md`: 2経路を書き、`export` の誤りを直す
- `docs/developer.md` の環境変数表: 新しい2つを追記

## やらないこと

- 原因2（シェルの環境変数がアイコン起動に届かない）そのものの解決。別 issue に切り出す
- #871（設定画面からキーを入れる）。案内文が直っても入力口が無いことは変わらない

## 確認

- `server/system/geminiKeyGuidance.ts` と `serverSpawnEnv` の単体テスト
- 設定 → Gemini タブに絶対パスが出ることを実機で確認（キーを外した状態で起動）
