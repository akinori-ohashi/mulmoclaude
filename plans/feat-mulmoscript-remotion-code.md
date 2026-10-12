# mulmoscript-plugin: remotion beat の `code` と書き方の約束を載せる

#3396。

## やること

- `presentMulmoScript` のツール説明の `remotion` に `code`（`kind: "path"` は台本のフォルダからの相対パス / `kind: "text"`）を足す。
  `prompt` とどちらか一方。会話しながら直したい・エージェントが自分で書けるなら `code`、任せきりなら `prompt`。
  1 ファイルで完結（相対 import 不可）、描画に失敗したら mulmocast がファイルとエラーを示して止まるので直して描画し直す、を書く。
- mulmocast の `REMOTION_COMPONENT_GUIDE` を参照ファイル `remotion-component-guide.md` として渡す（写さず import する）。
  `promptCompact` には「`code` を書く前にこのファイルを読む」だけ。ツールの `description` は参照ファイルを順に連結したもの
  （分割を知らないホストや ToolSearch で読み込んだモデルにも全部見える）。
- `mulmocast` / `@mulmocast/types` の下限を `^2.15.0` に上げる（ルート・launcher・プラグインの peer）。

## ガイドの取り込み元

`REMOTION_COMPONENT_GUIDE` は mulmocast 2.14.0 では `mulmocast/remotion` からしか読めず、この入口は `render.js`（`node:fs`）や
`@remotion/renderer` / `@remotion/bundler` も連れてくる。ツール定義はプラグインの `./vue` 入口からブラウザに届くので、
MulmoClaude の `vite build` にそれらが入ることを確認した。

そこで mulmocast 側にガイドだけの入口 `mulmocast/remotion/guide` を足した（receptron/mulmocast-cli#1606 / #1607）。
このプラグインはそれを import し、mulmocast / `@mulmocast/types` の下限をその入口を含む `^2.15.0` にする。

- `vite.config.ts` の external を `/^mulmocast(\/|$)/` にして、サブパスもバンドルしない。
- `test/test_browserSafeCore.ts`: `src/core/` が mulmocast から読んでよいのは `mulmocast/remotion/guide` だけ。

## 確認

- mulmocast-cli のビルドから新しい入口を一時的に `node_modules/mulmocast` に重ねて、プラグインの test / build / typecheck / lint と
  MulmoClaude の `vite build` を実行。`mulmocast/remotion` 由来の "externalized for browser compatibility" が消え、ガイドが
  バンドルに入ることを確認した。
