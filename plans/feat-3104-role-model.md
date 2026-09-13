# feat(#3104): ロールごとにモデルを指定する

## 背景

#2923（全体設定）と #2554（有効モデルの表示）がマージ済み。この issue はその1段細かい
粒度＝ロール単位。動機は「常駐のルーチンは中位モデル、ここぞの会話は最上位」で、
モデル別の週次上限を使い分けたいというもの。

## 当初案が成立しない理由（issue にコメント済み）

「ロール JSON に任意キー `model` を足すだけ、UI 不要」では成立しない。ロール
オブジェクトは4箇所でフィールド単位に再構築されるので、手書きのキーは UI 編集や
エージェント編集で黙って消える。

| 場所 | 何が起きるか |
|---|---|
| `src/config/roles.ts` `RoleSchema` | zod object が未知キーを剥がす |
| `src/plugins/manageRoles/roleForm.ts` `formToRole` | フィールドを手で組み直す |
| `src/components/RolesView.vue` | 同上（roleForm.ts を使わない重複実装） |
| `src/plugins/manageRoles/definition.ts` | MCP ツールのスキーマに無い |

よって **Settings → Roles の編集フォームに select を1つ足す**前提でスコープを取る。

## 決定事項（ユーザー確認済み）

1. ロール編集 UI にモデル選択を出す
2. カスタムロールのみ。**組み込みロールは global 設定に従う** — これは追加の仕組みが
   不要で自動的にそうなる。`GET /api/roles` は `loadCustomRoles()` しか返さない
   （`server/api/routes/roles.ts:17`）ので、組み込みロールは編集画面に存在せず
   `model` を持ちようがない
3. エイリアスは `src/config/models.ts` の `CHAT_MODELS` をそのまま使う（#3130 で
   単一化済み。`fable` / `opus` / `sonnet` / `haiku`）

## 解決

```ts
// server/agent/index.ts
chatModel: resolveChatModel(role, settings).model,
```

出所も返す純粋関数として切り出す。#2554 で入れた「実際に動いているモデル」の表示と
合わせて、「なぜこのモデルなのか」に答えられるようにするため。

```ts
resolveChatModel(role, settings): { model?: ChatModel; source: "role" | "global" | "shared" }
```

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `src/config/roles.ts` | `RoleSchema` に `model` |
| `src/config/chatModelSource.ts`（新規） | `resolveChatModel` 純粋関数 |
| `server/agent/index.ts` | `role.model ?? settings.chatModel` |
| `src/plugins/manageRoles/roleForm.ts` | `CustomRole` / `RoleForm` / `formToRole` / `roleToForm` / `parseRole` |
| `src/components/RolesView.vue` | 再構築サイト + select |
| `src/plugins/manageRoles/View.vue` | select（フォームは roleForm.ts 共有） |
| `src/plugins/manageRoles/definition.ts` | MCP スキーマに `model` |
| `server/api/routes/roles.ts` | `ManageRolesInput.role` に `model` |
| `src/lang/*.ts`（8言語） | ラベル + 「未設定＝全体設定に従う」 |
| テスト | 解決関数、schema の round-trip、フォーム round-trip |

## 検証

- **UI 編集でキーが消えないこと** — この issue の当初案を殺した欠陥なので、
  「モデル付きロールを作る → 別フィールドだけ編集 → モデルが残っている」を
  テストと実機の両方で確認する
- 実機で `role.model` を設定したロールのセッションが `--model` を受け取ること
  （ground truth は spawn された CLI の実 argv と #2554 のチップ）
- 組み込みロールが global に落ちること

## スコープ外

- セッション単位の一時上書き（`session ?? role ?? global` は後から真ん中を挟んでも
  壊れない）
- セッション途中のモデル切替
