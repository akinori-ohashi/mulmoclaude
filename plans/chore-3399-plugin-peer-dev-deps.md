# プラグインが peer に書いたパッケージを devDependencies にも書く

#3399。

## やること

CLAUDE.md の「A plugin declares host-provided packages as `peer` + `dev`」に合わせ、`peerDependencies` にあって
`devDependencies` に無いパッケージを、**peer と同じ範囲で** `devDependencies` に足す。

- `@mulmoclaude/mulmoscript-plugin`: `@mulmocast/beat-editor`、`@mulmocast/types`、`graphai`、`gui-chat-protocol`、`mulmocast`、`vue`
- `bookmarks` / `debug` / `edgar` / `email` / `google` / `recipe-book` / `spotify` の各プラグイン: `gui-chat-protocol`

## やらないこと

- peer と dev の範囲が違うもの（`vue` peer `^3.5.0` / dev `^3.5.43` など）は揃えない。今回は欠けているものを足すだけ。
- 公開済みの版は上げない。`devDependencies` は公開されるパッケージの利用者には影響しない。

## 確認

- lockfile が変わらない（どれもルートが同じ範囲以上で宣言済み）か、変わるなら理由を確かめる。
- devDependencies を足したので、クリーン install（`--frozen-lockfile`）から build / typecheck / lint / test。
