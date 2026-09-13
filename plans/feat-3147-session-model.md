# feat(#3147): セッション単位でモデルを一時上書きする

## 背景

#2923（全体）→ #2554（有効モデルの表示）→ #3104（ロール別）がマージ済み。
残るのは「普段は sonnet のロールだが、**この会話だけ** opus に上げたい」。
ロールだけでは重複ロールを作るしかなく、ロール一覧が用途ではなくモデルで増える。

## 方針

段を1つ増やすだけ。既存の解決点は1箇所なので、変更は素直に積める。

```
session  →  role  →  global  →  shared
```

| 変更 | 場所 |
|---|---|
| `SessionMeta.chatModel`（選んだ値） | `server/utils/files/session-io.ts` |
| `resolveChatModel` に引数追加 + `source: "session"` | `src/config/chatModelSource.ts` |
| 解決点に渡す | `server/agent/index.ts` |
| セッション設定の API | `server/api/routes/sessions.ts`（`bookmark` が前例） |
| チップから選ぶ UI | `src/components/SessionModelChip.vue` |

## 命名

- `SessionMeta.resolvedModel` — **観測値**。CLI の `system`/`init` が報告した実際のモデル（#2554）
- `SessionMeta.chatModel` — **設定値**。ユーザーがこのセッションに選んだ上書き（`AppSettings.chatModel` と同じ語）

観測と設定を名前で区別する。同じ語を使い回すと、どちらの話かが読めなくなる。

## UI

ピッカーを3つ並べない。#2554 で入れたチップを「有効な値 + 出所」の表示から
「そこから上書きもできる」コントロールに拡張する。

```
[⭐ Guide ▾]   [Sonnet 5 · ロールより ▾]
```

- 上書き中は見た目を変え、「既定に戻す」を出す
- セッション別は**一時上書き**であって対等な設定ではない

## 検証で外せない点

- **配線を固定する**。#3104 の Codex P3 と同じ穴を開けないこと。`buildAgentInput` を
  session 込みで駆動するテストを足し、session を無視する変異で赤くなることを確認する
- 実機で `--model` に session の値が乗ること（ground truth は spawn 引数と #2554 のチップ）
- 4段すべての優先順位（session > role > global > shared）

## スコープ外

- 進行中のターンの切り替え（次のターンから効く）
- ロール/全体設定 UI の変更
