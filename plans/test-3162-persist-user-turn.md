# test(#3162): persistUserTurn の「最初のターンがモデル上書きを運ぶ」1行を固定する

## 背景

#3148 で入れた最初のターンの carry には、**適用側の1行にテストが無い**。

```ts
if (isChatModel(params.chatModel)) await updateSessionChatModel(chatSessionId, params.chatModel);
```

消してもテストは全部緑。実機確認のみで担保している（#3148 のクロスレビュー中に scratch ワークスペース＋実 CLI で確認）。

## なぜ #3148 で書かなかったか

`startChat` をプロセス内で駆動すると実物の `~/.claude` が要る。プローブがそこで落ちた。
環境依存のテストは無関係な理由で CI を赤にするので、レビューループ終盤では入れず穴を明記した。

## 方針

`startChat` ではなく **`persistUserTurn` だけ**を駆動する。この関数は spawn を通らず、
ファイル IO と pub/sub しかしない。

```
createSessionMeta → (対象の1行) → incrementUserQueryCount → appendSessionLine → pushSessionEvent
```

`test/agent/test_buildAgentInput.ts` と同じ手筋で `HOME` / `MULMOCLAUDE_WORKSPACE_PATH` を
一時ディレクトリへ向けてから import すれば、実 CLI も `~/.claude` も要らない。

`persistUserTurn` は module private なのでテスト用に export する。
**前例あり**: 同リポの `buildAgentInput` が同じ理由で export され、docblock に理由が書いてある。

### 「seam を切り出す」案を採らない理由

Codex は #3148 round 3 で「`startChat` 全体ではなく『meta を作って最初のターンのモデルを
適用する』helper を切り出すほうが安い」と示唆した。採らない:

- 切り出しは**挙動保存の主張**になり、その証明コストが要る（グローバル規約）。
- 得られる安全性は export-for-testing と同じ。**カバーしたい行は同じ1行**。
- 新しいファイルと新しい間接参照が増え、読む人が追う距離が伸びる。

「動かせるようにする」ことが目的で、「小さくする」ことは目的ではない。

## 固定する規則

| # | 規則 | 変異させたときに赤くなること |
|---|---|---|
| 1 | 最初のターンはボディの既知 alias を sidecar に入れる | 対象の1行を消す |
| 2 | 2ターン目以降はボディの `chatModel` を取らない | `isFirstTurn` の条件を外す |
| 3 | 未知の alias はターンを越えて残らない | （下記のとおり、この層では固定できない） |

規則2が要る理由: sidecar が正。これが壊れると、古いタブが送ったターンが
新しい選択を巻き戻す。

### 規則3は「固定できない」と分かった（計測結果）

当初は「`isChatModel` の検証を外すと赤くなる」と書いていたが、**実際は緑のまま**だった。
呼び出し側の検証と `updateSessionChatModel` の検証の**両方**を外して計測したところ:

```
carry の書き込み直後      : { ..., "chatModel": "gpt-4o" }   ← ディスクに乗る
次の read-modify-write 後 : { ..., "userQueryCount": 1 }     ← 消えている
```

`persistUserTurn` の中で carry の直後に走る `incrementUserQueryCount` が、
読み込み時に未知 alias を落とす sanitiser（#3148）を通ってから全体を書き戻すため、
**次の書き込みが自動的に洗い流す**。

よってこの層のテストは「ターンの終わりに残っていない」という**最終状態**しか見られない。
それ自体は利用者から見た保証なので残すが、**どの層が弾いたかは固定していない**ことを
テストのコメントに明記する。保存側の拒否は `test/utils/files/test_session_io.ts` が
生ファイルに対して固定しており、2つの機構を区別できるのはそこだけ。

## スコープ外

- `startChat` 全体の統合テスト（spawn が要る）
- 別タブ反映（#3154）
