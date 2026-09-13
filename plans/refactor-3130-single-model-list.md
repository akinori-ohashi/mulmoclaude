# refactor(#3130): モデル一覧を1箇所で管理し、fable を追加する

## 背景

#2923（PR #3118）で入れた `chatModel` のモデル一覧が2箇所に二重定義されている。
`EFFORT_LEVELS` にも #1323 以来同じ問題がある。

| 場所 | 定義 |
|---|---|
| `server/system/config.ts:23,30` | `EFFORT_LEVELS` / `CHAT_MODELS` |
| `src/components/SettingsModelTab.vue:55,60` | 同じ配列のコピー |

**片方だけ増やしても何も壊れない**種類の重複。サーバに1つ足してもフロントの select には
出ず、フロントだけ足すとサーバのバリデータが 400 を返す — どちらもビルドもテストも通る。

## 方針

`src/config/models.ts` を単一の source of truth にし、サーバとフロントの両方がそこから
import する。`src/config/*` は既に「両方が読む定数」の確立した置き場所
（`server/` から `firebaseConfig` / `roles` / `pubsubChannels` / `toolNames` / `apiRoutes`
を import する前例が5箇所以上ある）。

あわせて `fable` を追加する。CLI 2.1.269 の `--model` はエイリアスとして
`fable` / `opus` / `sonnet` を挙げており、`fable` も正規のファミリー。
一覧を1箇所にした後なら追加は1行で、フロント・サーバ・テストの全部に同時に効く。
**これがこの refactor の価値を示す最初の実例になる。**

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `src/config/models.ts`（新規） | `CHAT_MODELS` / `ChatModel` / `EFFORT_LEVELS` / `EffortLevel` |
| `server/system/config.ts` | 定義を削除し import に置き換え（型は re-export せず、利用側を直接向ける） |
| `src/components/SettingsModelTab.vue` | ローカルのコピーを削除し import |
| 各利用側 | `EffortLevel` / `ChatModel` の import 元を付け替え |
| テスト | 新一覧からの参照に追随。`fable` が全経路に通ることを確認 |

## re-export しない

CLAUDE.md「理由なく re-export しない」に従う。`server/system/config.ts` から
`EffortLevel` を import している箇所（`server/agent/config.ts` /
`server/agent/backend/types.ts`）は `src/config/models.js` を直接向ける。

## 検証

- `grep` で `CHAT_MODELS` / `EFFORT_LEVELS` の**定義**がそれぞれ1つだけであること
- 一覧に1つ足す差分が、フロント・サーバ・テストのどこにも追加編集を要求しないこと
  （= `fable` の追加が実際に1行で済むこと）
- Settings → Model の select に `fable` が出て、保存でき、`--model fable` が spawn 引数に載ること

## スコープ外

`CHAT_INDEX_MODES` / `JOURNAL_MODES`（`["off","haiku","sonnet"]`）は統合しない。
`off` を含み、コスト上 opus を意図的に外している別系統の設定で、`CHAT_MODELS` に
追随すべきではない。
