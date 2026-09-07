# ci(pr_triage): 外部 PR は規模によらず受け付けない方針へ揃える (#2966)

## 背景

`.github/workflows/pr_triage.yaml` は「開発チーム外からの PR は plan-first ポリシーに沿わせる」
ためのガードだが、**10 行以下の外部 PR を素通りさせる例外**（`LINE_LIMIT: 10`）を持っている。
実際の方針は「外部からの PR は規模によらず受け付けない」なので、実装が方針を反映していない。

mulmoterminal の同名ワークフローが既にその方針を実装しており、さらに運用で踏んだ穴を
いくつか塞いでいる。そちらへ揃える。

## 差分（mulmoclaude 現状 → mulmoterminal 準拠）

| 項目 | 現状 | 変更後 | 理由 |
|---|---|---|---|
| 小規模例外 | 10 行以下は通す | **例外なし** | 方針そのもの |
| `branches:` | `[main]` のみ | フィルタなし | `main` 以外の長命ブランチ宛の PR も同じくレビュー不能 |
| `sender` 判定 | 無し | 許可リストで stand down | メンテナが意図的に残した外部 PR をリタイトルすると `edited` で再発火し、自動化が人間の判断と衝突する |
| 冪等化 | `synchronize` を外す + payload の `state` | コメント本文の marker を検出 | reopen 時に二重コメントしない。`gh pr comment` は冪等でない |
| state 判定 | イベント payload | `gh pr view` でライブ取得 | クローズ直前に生成された `edited` は state=open を載せたまま届く |
| 文面 | 英語のみ | 日英併記 | 日本語話者の contributor が主 |
| `cancel-in-progress` | `true` | `false` | 連続イベントで前段の実行がキャンセルされるとクローズを取りこぼす |

## 移植時に落としてはいけない実装細部

mulmoterminal 側のコメントに、実際に踏んだ罠として記録されているもの:

- **`grep -qF` をパイプの受け手にしない。** `gh api --paginate ... | grep -qF` は `grep` が
  最初のマッチで抜け、`gh` が SIGPIPE(141) で死に、`pipefail` がそれを伝播する。`if` は
  「marker 無し」と読んで、防ごうとしていた二重コメントをまさに投稿する。**コメント一覧を
  先に変数へ集めてから** `grep -qF <<< "$COMMENTS"` で判定する。小さなテスト PR では
  再現せず、コメントが増えた本番 PR でだけ壊れる種類のバグ。
- **クォート付きヒアドキュメント（`<<'EOF'`）で本文を組み立てる。** 本文にバッククォートや
  `$` が入るため。変数の埋め込みは後段の bash パラメータ展開（`${BODY//__DOC_LINK__/...}`）で行う。
- **`grep -Fxq` で許可リストを判定する。** 固定文字列かつ行全体一致なので、`[bot]` の角括弧が
  正規表現の文字クラスとして解釈されず、メンテナ名を部分的に含むだけの login も誤マッチしない。
- **`pull_request_target` を使う理由と、それが安全である根拠のコメントを残す。** PR のコードを
  checkout しない・PR 由来の値は `env:` 経由でのみシェルへ渡す、の 2 点。zizmor の
  `dangerous-triggers` 抑制コメントも維持する。

## mulmoclaude 固有で残すもの

- 許可リストに **`yuki0627`** を含める（mulmoterminal 側には居ない）
- リンク先は `docs/developer.md#contributing--please-open-an-issue-with-a-plan-first`
  （mulmoclaude は `CONTRIBUTING.md` を持たず、Contributing は developer.md の一節）

## ドキュメント同時更新（必須）

`docs/developer.md` の Contributing セクションは現在:

- 「### When you can skip the plan」に **「10 行以下の単一ファイルのバグ修正」** を直接 PR 可として列挙
- 「### Automated triage on pull requests」に **「10 行以下なら自動で受理」** と明記
- 「The line cap and the documentation are intentionally kept in lock-step」と自ら宣言

ワークフローだけ変えると文書と実装が矛盾するため、**同じ PR で両方直す**。

## 検証

ワークフローは CI 上でしか実行できないため、次で担保する:

1. `yarn lint:workflows`（zizmor 相当があれば）／`workflow-lint.yaml` の CI ジョブ
2. YAML パースと、シェル部分の `bash -n` 相当の構文チェック
3. 埋め込みシェルスクリプトを取り出し、**許可リスト判定・marker 判定・state 判定の分岐を
   ローカルで実際に走らせて**期待どおりに分岐することを確認する（メンテナ / 外部 / bot /
   marker 済み / クローズ済みの各ケース）
4. 実 PR での発火は本番でしか観測できないため、PR に「未検証の範囲」として明記する

## スコープ外

- `CONTRIBUTING.md` の新規作成（GitHub の PR 作成画面に提示される利点はあるが別判断）
- 許可リストの人員変更
