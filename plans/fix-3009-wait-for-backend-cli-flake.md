# fix #3009 — wait-for-backend CLI テストの起動時間依存を消す

## 問題

`test/scripts/test_waitForBackendCli.ts` の publish が `spawn()` からの固定 400ms タイマーで、
CLI 子プロセスの `tsx` cold boot と競合する。boot が 400ms を超えると publish が
before スナップショットより先に着地し、以後 mtime が変わらないため `wasRepublished()` は
（設計どおり）「この run の publish ではない」と判定 → `PORT` にフォールバックして timeout。

ubuntu の CI でスイート先頭（最も cold な spawn）が落ちた。

## 方針

製品コード (`scripts/wait-for-backend.ts`, `scripts/lib/publishedPort.ts`) は変更しない。
「スナップショット時に既にあるファイルは信用しない」は #2981 の意図した契約で、
同スイートの `does not follow a leftover file from a dead run` が固定している。

フィクスチャを **CLI 終了まで publish を撃ち続ける** 形にする:

- `PUBLISH_INTERVAL_MS` で `.server-port` を書き直し続け、`runCli` の解決時に `clearInterval`
- boot がいつ終わっても「スナップショット後の write」が必ず 1 回は起きる
- `attributable=false` のケースはスナップショット後の write でしか成功しないので、
  「publish を学んでから待つ」という証明対象の順序は保たれる

## publish は本番と同じく atomic に

CodeRabbit 指摘。素の `writeFileSync` は `O_TRUNC` で開くので、truncate と write の
あいだに読んだ側は**空ファイル**、write 中に読んだ側は**前方一致の断片**を見る
（`3002` が `300` になり、何も listen していないポートとして正常にパースされる）。
CLI は mtime が動いた後に 1 回だけ読むので、torn read 1 回で wait 全体が落ちる。

実サーバ (`server/workspace/serverPort.ts`) は `writeFileAtomic` で tmp→rename しており、
まさにこの危険を潰すためだと冒頭コメントに書いてある。フェイクバックエンドが非 atomic に
書くのは**本番が起こしえない危険をモデル化している**ことになるので、フィクスチャの publish も
tmp→rename に揃える（`publishPort`）。テスト 3 の 1 発 publish も同じ経路に通す。

## 適用範囲

| テスト | 変更 | 理由 |
|---|---|---|
| `waits on the WALKED-TO port` | 置換 | 今回落ちた本体 |
| `PORT=0 is usable now` | 置換 | 同じ競合を持つ（今回はたまたま通った） |
| `never refuses to start Vite` | 置換 | 競合で 8s 空回りしていた（assert は緩いので落ちはしない） |
| `--reset makes a later publish attributable` | 据え置き | 先行する `--reset` 実行で tsx が温まっており、かつ `attributable=true` の近道でどちらの順序でも通る |
| `does not follow a leftover file from a dead run` | 据え置き | publish 前置きが仕様そのもの |
| `never reports readiness for ...` | 据え置き | publish しないケース |

## 検証

1. `PUBLISH_DELAY_MS = 0`（boot > delay と等価）で現行テストが CI と同じメッセージで落ちることを確認（済）
2. 修正後、同じ「publish がスナップショットより先に着地する」条件を強制しても通ることを確認
3. `yarn tsx --test ./test/scripts/test_waitForBackendCli.ts` を複数回
