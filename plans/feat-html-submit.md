# presentHtml のページから確認付きで結果を会話へ返す (#3581)

## 目的
計画などを `presentHtml` で出し、ユーザーがモックや操作で選んだ結果を、コピー貼り付けなしで会話の次のメッセージとして返せるようにする。

## 仕組み
1. ページは `window.parent.postMessage({ type: "mulmo-html-submit", text }, "*")` を送る。
2. View の `message` リスナーは `readSubmitMessage(event, iframe.contentWindow)`（`src/core/submitMessage.ts`、純粋関数）で判定する。
   - 送り元が自分の iframe でない、型が違う、`text` が文字列でない、空白だけ → 無視。
   - 上限（`MAX_SUBMIT_TEXT_CHARS`）超え → 「長すぎる」と確認欄に出し、送らない。切り詰めない（決めた内容が欠けたまま届くのを避ける）。
3. 受けた文は iframe の外の確認欄に出す。ユーザーは編集でき、「送信」を押したときだけ `sendTextMessage` を呼ぶ。「破棄」で消える。新しい送信が来たら置き換える。
4. `sendTextMessage` を渡さないホストでは、受けたメッセージを何もせず捨てる（受けた時点で判定するので、prop が後から変わっても追従する）。

## 決めたこと
- 確認欄は必須。LLM が書いたページが、ユーザーの操作なしに会話へ打ち込めないようにする（iframe 内のクリックはホストから見て本物か判定できない）。
- CSP / sandbox は変えない。`postMessage` は `connect-src` の対象外で、不透明 origin のままでも親へ届く。
- 送り元の判定は `event.source` で行う。不透明 origin では `event.origin` が `"null"` になり、origin では区別できないため。
- ツールの `prompt` に送り方を足す。両ホストの MCP の説明文が変わるが、意図したもの。

## 範囲外
- 計画の書き方を教える skill（receptron/mulmoterminal#3162）。
- View の既存 `<style scoped>` を utilities へ移すこと（別の変更として扱う）。
