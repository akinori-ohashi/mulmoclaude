# CI: macOS の `lint_test` が 20 分のタイムアウトで落ちる（#3007）

## 症状

`pull_request.yaml` の `lint_test` の **macOS セルだけ**が `timeout-minutes: 20` に達して cancel される。
テストが落ちているのではなく `test:coverage` の途中で打ち切られる（`##[error]The operation was canceled.`）。
同じランの ubuntu セルは全て成功しているので、コード側の問題ではない。

## 実測 — 上限に対する余裕が macOS だけ無い

直近 60 ランの `lint_test` を Actions API から step 単位で取得した（成功セルのみ、n はセル数）。

| セル | n | p50 | p90 | max | 上限までの余裕 (p90) |
|---|---:|---:|---:|---:|---:|
| `lint_test (22.x, macos-latest)` | 60 | 14.5 | **19.3** | 20.6 | **0.7 分** |
| `lint_test (24.x, macos-latest)` | 60 | 14.2 | **18.0** | 20.2 | 2.0 分 |
| `lint_test (22.x, ubuntu-latest)` | 60 | 13.6 | 15.5 | 16.4 | 4.5 分 |
| `lint_test (24.x, ubuntu-latest)` | 60 | 12.3 | 13.9 | 14.7 | 6.1 分 |

実際にタイムアウト kill されたラン（macOS セルが 20 分ちょうどで cancel、ubuntu 兄弟は全て成功）:

| run | 22.x macos | 24.x macos | 22.x ubuntu | 24.x ubuntu |
|---|---|---|---|---|
| 33250382799 (#3005) | **cancel 20.4** | **cancel 20.1** | ok 13.1 | ok 14.1 |
| 33223509289 | ok 13.8 | **cancel 20.2** | ok 14.5 | ok 13.6 |
| 33218655575 | **cancel 20.1** | ok 18.0 | ok 16.4 | ok 14.2 |
| 33216423367 | **cancel 20.2** | ok 17.7 | ok 15.5 | ok 14.3 |
| 33212805307 | **cancel 20.6** | ok 19.0 | ok 15.8 | ok 14.6 |

**60 ラン中 5 ランで発生**。単発の flake ではない。

runner の速さ自体が日単位で動いている:

| 日 | macOS 成功セル n | p50 | max |
|---|---:|---:|---:|
| 2026-08-28 | 21 | **17.7** | 20.0 |
| 2026-08-29 | 56 | 14.8 | 19.3 |

8/28 は**中央値が 17.7 分**で、半分のセルが上限まで 2.3 分を切っていた。

## `yarn.lock` を触る PR が特に危ない

`lint_test` はロックファイルのハッシュをキーに含むキャッシュを 3 つ使うが、**依存更新 PR で
実際にコールドになるのは 2 つだけ**。#3005 の macOS ジョブのログで確認した:

| キャッシュ | キー | `restore-keys` | #3005 での結果 |
|---|---|---|---|
| setup-node の yarn キャッシュ (`cache: yarn`) | `node-cache-<OS>-<arch>-yarn-<lock ハッシュ>` | 無し | `yarn cache is not found` → **ミス** |
| `Cache packages/dist` | 末尾に `'yarn.lock', 'package.json'` | **無し** | `Cache not found for input keys` → **ミス** |
| `Cache puppeteer browsers` | `puppeteer-<OS>-<lock ハッシュ>` | `puppeteer-<OS>-` あり | `Cache hit for restore-key` → **ヒット（warm）** |

つまり上乗せされるのは **cold install（setup-node のキャッシュ）と cold build:packages
（`packages/dist`）の 2 つ**で、puppeteer の chrome 再ダウンロードは起きていない。
#3005（依存のバージョン上げのみ）で実際に出た差:

| ステップ | #3005 (macos 22.x) | 同日の main (macos 22.x) |
|---|---:|---:|
| `yarn install` | 2m26s | 42s |
| `build:packages` | 2m25s | 1m11s |
| `typecheck` | 2m39s | 1m23s |
| `lint` | 7m08s | 4m42s |
| `build` | 2m55s | 1m40s |
| `test:coverage` | **2m08s で cancel** | 3m37s (pass) |

比較できる 5 ステップの倍率は **1.5〜3.5 倍**（install 3.5x / build:packages 2.0x /
typecheck 1.9x / lint 1.5x / build 1.75x）。`test:coverage` は cancel されたので比較対象外。
最大の install は cold cache で説明がつくが、キャッシュと無関係な typecheck・lint・build まで
1.5〜1.9 倍になっているので、この日は runner 自体も遅かった。

#2857 の調査で判明しているとおり、このリポジトリの Actions キャッシュは既に 10 GB の上限を
超えて LRU 追い出しが起きているため、キャッシュヒット率自体も安定しない。

## やること

`.github/workflows/pull_request.yaml` の `lint_test` の `timeout-minutes` を **20 → 30**。

根拠:

- Windows 版の同等ジョブ `lint_test_windows.yaml` は既に `timeout-minutes: 30`。揃えるだけ。
- 観測最大 20.6 分に対して 9 分以上の余裕ができる。8/28 のような遅い日（p50 17.7）でも
  cold cache 分（実測 +3〜4 分）を吸収できる。
- タイムアウトは暴走ジョブを止める保険であって性能予算ではない。上げても正常なジョブの
  実行時間は変わらず、課金も実時間に対してなので無駄は出ない。

なぜ上限を測定値で決めたのかがコメントから読めるよう、ワークフローに実測を残す。

## やらないこと（独立した判断なので分ける）

- **ジョブ本体の高速化**。`lint` が macOS で 4.7〜7.1 分と最大の項目で、短縮する価値はある。
  `Cache packages/dist` に `restore-keys` を足せば依存更新 PR の cold build も減らせる
  （puppeteer キャッシュが実際にそうやって warm を保っている）。
  どちらも上限引き上げとは独立に評価すべきなので別 issue にする。
- `e2e` ジョブ（`timeout-minutes: 15`、実測 11m3s / 11m27s）。余裕 3.5 分でタイムアウト
  kill の実績も無いため今回は触らない。

## 検証方法

ワークフロー自身の変更なので、この PR の CI で新しい上限が適用されたジョブが走る。
確認するのは次の 2 点:

1. `lint_test` の 4 セルが全て成功すること。
2. **所要時間が変わっていないこと** — 上限引き上げはジョブを速くも遅くもしない。
   変わっていたら別の要因が混ざっている。

```sh
gh api "repos/receptron/mulmoclaude/actions/runs/<RUN_ID>/jobs?per_page=50" \
  --jq '.jobs[] | select(.name|test("lint_test")) | [.name,.conclusion,.started_at,.completed_at] | @tsv'
```
