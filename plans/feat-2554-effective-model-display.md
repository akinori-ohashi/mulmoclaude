# feat(#2554 後半): いま実際に動いているモデルを表示する

## 背景

#2554 は2つを求めていた。前半（設定でモデルを選ぶ）は #2923 / PR #3118 で出荷済み。
残るのは「いま実際にどのモデルで動いているか」の表示。

**設定を読むだけでは答えられない。** `chatModel` 未設定のとき MulmoClaude は `--model` を
渡さず、CLI が `~/.claude/settings.json` から解決する。フロントにはその中身が見えない。
つまり #2554 が問題にしている「気づけない」ケースこそ、設定からは分からない。

## ground truth は CLI 自身の申告

CLI は `system`/`init` フレームで解決済みモデルを申告している。実測（CLI 2.1.269）:

| 起動 | `init.model` |
|---|---|
| フラグなし | `claude-opus-5[1m]` ← 共有設定が解決した値、`[1m]` 込み |
| `--model haiku` | `claude-haiku-4-5-20251001` |

設定の推測ではなく、これを表示する。

## 経路

```
system/init (stream)
  → SESSION_MODEL 内部イベント        server/agent/stream.ts
  → handleAgentEvent が out-of-band 処理   server/api/routes/agent.ts
      ├ SessionMeta.resolvedModel に永続化   （リロード後も出る）
      └ session_meta を channel に publish   （初回ターン中にも出る）
  → parseSseEvent → applyAgentEvent → ActiveSession.resolvedModel
  → SessionModelChip（role ヘッダの隣、2箇所）
```

## プロトコルを変えない

`SESSION_MODEL` は `server/agent/stream.ts` のローカル定数（`INJECTED_TEXT` と同じ扱い）。
ライブ配信は既存の `session_meta` 型に相乗りする。`@mulmobridge/protocol` は無変更で、
publish カスケードが不要。

## スコープ外

**出所（設定 / ロール / 共有）の表示**は入れない。いま段は「設定 or 共有」の2つしかなく、
設定済みかどうかは設定タブで分かる。未設定なのにチップが `Opus 5 · 1M` と出ること自体が
#2554 の求めた発見であり、それで足りる。出所の表示は #3104（ロール別）で段が増え、
`resolveChatModel` が必要になった時点で意味を持つ。
