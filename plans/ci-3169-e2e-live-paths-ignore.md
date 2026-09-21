# #3169 — e2e-live のパスフィルタを列挙から `paths-ignore` へ反転する

## 背景

`e2e_live_no_llm.yaml` の `pull_request` トリガは「影響するパスを列挙する」形になっている。
#3146 は `server/agent/stream.ts` を変えても発火しない件を、フィルタを
`server/agent/backend/**` → `server/agent/**` に広げて閉じた。instance は閉じたが class は残る:
**列挙である限り、次に増えたディレクトリは常に漏れる**。しかも漏れ方が
「テストが走らない＝緑に見える」という危険な方向。

e2e-live は実ブラウザを実 dev サーバに当てる。つまりサーバ側もフロント側も
ほぼ全部が影響範囲で、「列挙しきる」こと自体が原理的に無理な形になっている。

## 決定

issue の選択肢1（推奨案）を採る: `paths` の列挙をやめ、repo 既存の `paths-ignore` 形に揃える。

```yaml
paths-ignore:
  - 'docs/**'
  - 'plans/**'
  - '**/*.md'
```

`pull_request.yaml` / `duplication-scan.yaml` / `lint_test_windows.yaml` が既に使っている形。
「ドキュメントだけの変更なら回さない、それ以外は回す」なので、新しいソースディレクトリが
増えても自動的に対象になり、危険な方向に不完全にならない。

## コストの再測定 — issue の「PR あたり4分増える」は成り立たない

issue はコストを「wall clock 約4分増」と見積もっていたが、これは e2e-live を直列に足した場合の話。
実際には同じ PR イベントで `pull_request.yaml` が並行して走っており、そちらのほうが桁で長い。
再測定のしかた:

```bash
gh run list --workflow=e2e_live_no_llm.yaml --limit 12 --json createdAt,updatedAt,conclusion
gh run list --workflow=pull_request.yaml     --limit 10 --json createdAt,updatedAt,conclusion
```

- e2e-live の wall clock は本体 CI の wall clock より**短い**（直近実績で数倍の開き）。
  並行実行なので **PR がマージ可能になるまでの時間は伸びない**。critical path は本体 CI のまま。
- 課金: `receptron/mulmoclaude` は public repo、standard runner なので Actions 分は無料。
- 安定性: 直近ランは全て success。

つまり issue が「判断が要る」とした唯一の対価は、測り直すと critical path にも課金にも乗らない。
残るのは runner の同時実行枠の消費のみ。

## やらないこと

- `branches: [main]` は足さない。現状 e2e-live は main 以外を向いた PR でも走っており、
  パス次元だけを広げる。トリガの絞り込みは今回のスコープ外。
- matrix・spec 一覧・ジョブの中身は触らない。

## 検証

ソース変更ではなく workflow の YAML 変更なので、ground truth は CI 側:

- `workflow-lint.yaml` が `.github/**` で発火し、actionlint + zizmor がこの PR にかかる。
- この PR 自身が `.github/workflows/e2e_live_no_llm.yaml` を変更しているため、
  **旧フィルタでも新フィルタでも e2e-live が発火する**。よって PR 上で新トリガの構文が
  実際に起動することまで確認できる。
- 反転が効いていることの本番確認は、次に来る `src/**` だけの PR で e2e-live が走るかどうか。
