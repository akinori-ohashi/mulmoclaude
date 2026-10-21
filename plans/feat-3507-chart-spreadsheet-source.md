# chart-plugin: グラフが表の範囲を指す（#3507）

receptron/mulmoterminal#3096 の案 A。表を直すと、開いているグラフも描き直される。

## 形

```json
{ "source": { "spreadsheet": "artifacts/spreadsheets/2026/10/abc.json", "range": "Summary!A1:C13" },
  "option": { "xAxis": { "type": "category" }, "yAxis": {}, "series": [{ "type": "bar" }] } }
```

画面は `option` に `dataset: { source: 行 }` を足して描く（あった `dataset` は置き換える）。`series` は `encode` か ECharts の既定の対応で列を選ぶ。

## 誰が何をするか

- **範囲を読むのはホスト**。`ChartExecuteContext.sources?: { read(source) }`。範囲を計算するのは表のプラグインの仕事で、プラグインは別のプラグインを読み込まない（CLAUDE.md の決まり）。MulmoTerminal は `@gui-chat-plugin/spreadsheet/core` の `readCalculatedRange` で実装する。
- `presentChart` のときに `source` を一度ずつ読み、読めなければ何も保存せずにエージェントへ理由を返す。`sources` の無いホストでは「データを option に入れて」と返す。
- 画面からの `dispatch({ kind: "readSource", source })` は同じ `execute`（`executeChartTool`）が受け、`{ data: { rows } }` を返す。
- 画面は `file:<spreadsheet>` を購読し、知らせが来たら読み直して描き直す。新しい読み込みが古いものを追い越したら、古い結果は捨てる。
- runtime の無いホストでは、`inject(PLUGIN_RUNTIME_KEY, undefined)` が空なので、`option` をそのまま描き、つながっていないことをカードに出す。

## 試したこと

- `test/plugins/chart/test_chartSource.ts`：形の判定、dispatch の返事の読み方、`dataset` の差し替え、`execute` が読めない範囲・`sources` の無いホストで何も保存しないこと。
- MulmoTerminal に手元でビルドしたものを入れ、表を指すグラフを出し、表のセルを保存すると開いたままのグラフが描き直されることを画面で確かめた。

## やらないこと

- MulmoClaude 本体で `sources` を渡すこと（表を `@gui-chat-plugin/spreadsheet` に切り替える #3498 のあと）。
