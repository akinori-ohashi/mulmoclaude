# 表計算を内蔵版から @gui-chat-plugin/spreadsheet に切り替える（#3497）

## 目的

`src/plugins/spreadsheet`（本体に内蔵の表計算）をやめて、`@gui-chat-plugin/spreadsheet@^4.3.0` を使う（当初は 3.0.0。`readCalculatedRange` は 4.1.0 から、関数一覧の公開は 4.3.0 から）。3.0.0 はこちらの View を元に、保存（`files.artifacts`）と多言語対応（`createUseT`）を gui-chat-protocol 経由にしたもの（receptron/GUIChatPluginSpreadsheet#37）。MulmoTerminal も同じパッケージを使う。

## 方針（chart-plugin / html-plugin と同じ形）

- **作成**：`META` と `POST /api/spreadsheet` は残し、ルートは `executeSpreadsheet({ files: { artifacts: makeArtifactsFileOps() } }, req.body)` を呼ぶだけの薄い中継にする。保存先と形式（`artifacts/spreadsheets/YYYY/MM/<16桁の16進>.json`、シート配列の JSON）は今と同じ
- **画面からの読み書き**：`server/plugins/spreadsheet-builtin.ts` で `registerBuiltinDispatch("spreadsheet", …)`。`isSpreadsheetDispatchArgs` で確かめて `executeSpreadsheetDispatch` に渡し、保存の後は `publishFileChange` を出す
- **画面**：`src/plugins/spreadsheet/index.ts` はパッケージの `View` / `Preview` を `wrapWithScope("spreadsheet", …)` で包み、`style.css` を読む
- **ツールの説明**：パッケージの `TOOL_DEFINITION` を使い、`prompt` だけはこちらのもの（`config/helps/spreadsheet.md` を指す）を重ねる
- **外すもの**：内蔵の View / Preview / engine / 補助モジュール、更新ルート `PUT /api/spreadsheet/update`、`spreadsheet-store.ts` の保存・上書き、`pluginSpreadsheet` の訳（8 言語）、engine の単体テスト（パッケージ側にある）、lint / 重複検査の除外設定
- **残すもの**：xlsx 添付の変換（`attachmentConverter.ts` と同梱の SheetJS、ルートの `xlsx` 依存）、`artifacts/spreadsheets` のディレクトリ定義、StackView の扱い

## 4.3.0 に上げたときに変えたもの

- main 側で内蔵の engine に入った修正（`LOG10` など数字を含む関数名）は、パッケージにも入っている
- ヘルプ（`packages/core/assets/helps/spreadsheet.md`）の関数一覧を、パッケージの `registeredFunctionsByCategory()` に合わせた。ブックで定義する関数（`functions`）にも触れる
- `test/plugins/spreadsheet/test_helpFunctions.ts` は、内蔵の `functionRegistry` の代わりにパッケージの `registeredFunctionsByCategory()` / `isRegisteredFunction()` と突き合わせる。`NORM.DIST` のような点を含む名前も拾う
- ヘルプを変えたので `@mulmoclaude/core` を 5.12.1 にし、依存範囲をそろえた
- `yarn add` は root の `resolutions` を当てずに lockfile を書くので、その後に `yarn install` をやり直して固定を戻した

## 互換

- 既存の会話の `data.sheets` は `artifacts/spreadsheets/…json` のパスか、古い形の配列。パッケージの View はどちらも開ける
- e2e は `/api/files/content` の代わりに dispatch（`/api/plugins/runtime/spreadsheet/dispatch`）を受ける形に書き直す

## 確認

- `yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / 単体テスト / 表計算の e2e
- アプリを起動し、既存の保存ファイルを開く、新しく作る、セルを直して書き戻す、を確かめる
