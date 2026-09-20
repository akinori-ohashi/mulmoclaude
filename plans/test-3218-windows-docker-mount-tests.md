# test(sandbox): Windows CI の docker マウント系テストをホストと整合させる (#3218)

## 背景

`lint_test (Windows)` が main で継続的に赤。ubuntu / macOS の `lint_test` は緑なので、
個々の PR に責任はなく、dep 更新 PR（#3212）が自分と無関係な赤でブロックされている。

赤は二波で入った。どちらの PR も、マージ時点で既に Windows が赤だったため、
自分が足した分が見えていない。

- `pluginLedgerMountArgs` → #3188
- `buildDockerSpawnArgs` / `dockerBindMountArgs` / `planConfigMounts` / `resolveSandboxAuth` /
  `sshAgentForwardArgs` / `planReferenceDirs` / `resolveReferenceDir` / `buildSandboxStatus` → #3193

## 原因

`dockerMount.ts` の設計どおり `platform` は引数で、Windows のルールを POSIX ランナーから
検証できるようにしてある。テストはその `platform` を `"linux"` / `"darwin"` に固定したまま、
fixture のパスをホストの `path.join()` / `mkdtempSync()` で綴っている。POSIX ホストでは
両者が一致するので誰も気づかないが、Windows ランナーでは食い違う。

機構は四つ。いずれも `platform` に依存する分岐が、ホストの綴りと噛み合わなくなる:

1. `toDockerSource` — `\` → `/` は win32 のときだけ。`"linux"` 宣言だと `\proj\node_modules` が
   そのまま mount source になる。
2. `withoutDriveLetter` — ドライブレターの除去も win32 のときだけ。`C:` のコロンが残ると
   `-v` ではなく `--mount` が選ばれ、argv の形が変わる。
3. `pluginLedgerMountArgs` の `sep` — `"linux"` 宣言だとホスト絶対パスの前方一致が成立せず、
   ledger の書き換えが何も起きない → `staged` が空 → `{ args: [], stagingDir: null }`。
4. `isSensitiveMountPath` の比較モジュール — `"linux"` 宣言だと Windows パスが `path.posix.resolve`
   に渡り、相対パス扱いで cwd が前置される。ブロックすべき symlink の target が `ok` になり、
   **#3200 のセキュリティ不変条件が Windows では検証されていない**。

独立した第二の原因として、fixture のディレクトリ名そのものが NTFS で作れないものがある
（`with:colon,and-comma` / `bad:with,both` / `fine:without,docker` / `stag:ing` / `stag"ing` /
`stag\ning` / `we\ird`）。これらは「POSIX のファイル名として合法な文字を docker のフラグが
運べるか」を見るテストなので、Windows では前提が成立しない。

## 方針

プロダクトは直さない。本番で `platform` は常に `process.platform` で、ホストの `join` と必ず
一致する。`platform` をホストに合わせて join させる（`path.win32` / `path.posix` を選ぶ）案も
検討したが、POSIX ランナー上で `platform: "win32"` を渡して実 fs を読む現行テスト
（`workspaceModuleMounts` 系）が壊れるので採らない。

テスト側を、二つの書き方のどちらかに寄せる:

- **ホスト依存のテスト**（実 fs を触る／ホストが綴るパスを食わせる）→ `platform` に
  **ホストの platform** を渡す。Windows では win32 の変換が入り、ホスト綴りが POSIX 綴りに
  戻るので、既存の期待値が両プラットフォームでそのまま成立する。
- **その platform のルール自体を見るテスト**（`platform: "win32"` に `C:\...` を渡す等）→ 現状維持。
- **POSIX のファイル名意味論に依存する fixture** → `{ skip: process.platform === "win32" }`。
  リポジトリに既にある書き方に合わせる。

## 変更するファイル

| file | 変更 |
|---|---|
| `test/agent/test_agent_config.ts` | `baseParams()` と `dockerBindMountArgs` の `opts` の platform をホストに |
| `test/agent/test_plugin_ledger_mount.ts` | `PLATFORM` をホストに / 期待値を `toDockerSource` 経由に / NTFS 不可名の 5 件を skip |
| `test/agent/test_sandboxMounts.ts` | 2 件を skip、2 件を platform ホスト化（うち 1 件は名称を *非 macOS* に） |
| `test/api/test_sandboxStatus.ts` | NTFS 不可名の 1 件を skip |
| `test/utils/test_claudeConfigEnv.ts` | 子プロセスの probe が渡す platform をホストに |
| `test/workspace/test_reference_dirs.ts` | NTFS 不可名の 5 件を skip / symlink 系 describe の platform をホストに＋mount arg の解析を Windows 安全に |

## なぜ二度見逃されたか（この PR では直さない）

`lint_test (Windows)` は `pull_request` では `server/utils/launcher/**` /
`test/utils/launcher/**` / `packages/client/**` に触れた PR でしか走らない
（Windows ランナーのコストを避けるため #1585・#2613 で意図的に絞ったもの）。
#3188 も #3193 もそのパスに触れていないのでマージ前に Windows が走らず、赤は
push-to-main の run で初めて出た。その時点で main は既に赤だったので、どの PR の赤か
分からなくなっていた。

paths を広げる案は検討した上で見送る。Windows ランナーのコストを避けるという既存の
判断を優先し、このブランチの検証は `workflow_dispatch` の手動実行で行う。

## 検証

- ローカル（macOS）: `yarn format` → `yarn build:packages` → `yarn typecheck` → `yarn lint` → `yarn build`、
  対象 6 ファイルの `yarn test`。**変更前にも同じ 6 ファイルを走らせ、緑のままであること**を先に記録する
  （POSIX 側の振る舞いを変えていない、が本 PR の「同じ挙動」主張なので）。
- 実機の ground truth は Windows ランナーしかない。push して `lint_test (Windows)` の 22.x / 24.x を読み、
  同時に ubuntu / macOS が緑のままであることを確認する。
- skip にした件数はプラットフォーム別のカバレッジ差になるので、PR 本文で何を Windows で
  見なくしたかを明示する。
