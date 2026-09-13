# fix(publish): drift ゲートの走査範囲と指標を直す (#3116)

## 測って分かったこと（設計はこれで決まった）

### 1. 走査範囲が 4 パッケージだけ

`detectMulmobridgeDeps()` は launcher の `dependencies` から `@mulmobridge/*` だけを拾う
（`drift.mjs:228`）。実際に見られているのは **chat-service / client / protocol / web-push** の 4 つ。
`@mulmoclaude/common`（他 32 workspace が依存）、`@mulmobridge/webhook-runtime`（9）、
`@mulmoclaude/core`（8）、`@mulmoclaude/markdown-utils`（2）、`@receptron/task-scheduler`（1）は
対象外。#3109 の export 追加 2 件が素通りしたのはこれ。

workspace が別の workspace を宣言しているものを数えると **20 パッケージ**が候補。

### 2. 指標（src の export 行数）が bundle ビルドで壊れる

| package                 | ビルド   | local src 行 | local dist 行 | 公開 dist 行 | 現指標の判定                       |
| ----------------------- | -------- | ------------ | ------------- | ------------ | ---------------------------------- |
| `@mulmoclaude/common`   | tsc      | 19           | 17            | 16           | 正しく drift                       |
| `@mulmoclaude/x-plugin` | **vite** | 6            | 1             | 1            | **DRIFTED（誤検知）**              |
| `@mulmoclaude/core`     | **vite** | —            | —             | —            | local 229 / 公開 30 の無意味な比較 |

現行の「local **src** の export 行数 vs 公開 **dist** の export 行数」は、dist が src を
1:1 で写す tsc ビルドでしか成立しない。広げた状態で測ると google / spotify / x の 3 plugin が
DRIFTED になるが、**3 件とも誤検知**（bundle 済み dist を src と比べている）。

### 3. 行数では bundle の追加 export を取りこぼす

```
x-plugin の dist: export { extractTweetId, formatTweet, readUrlArg, readXPost, searchX, tweetBody };
```

**1 行に 6 名前**。7 つ目を足しても行数は 1 のままなので、行数比較は素通りする。

## 決めたこと

1. **走査範囲**: 「publish 対象 かつ 別の workspace が宣言している」workspace すべて（scope 非依存、
   パス規約非依存）。launcher しか依存していない plugin も対象に含める — launcher の公開コードが
   その export を呼ぶので、壊れ方は同じ。
2. **比較対象**: **local の build 済み dist ↔ 公開 dist**。src とは比べない。
   smoke ワークフローは `yarn build:packages && yarn build` の後に走る（`mulmoclaude_smoke.yaml:80,86`）ので
   CI では dist は新鮮。
3. **指標**: 行数ではなく **export される名前の集合**。`exports` map の各 subpath entry について、
   同じ相対パスのファイルを local と公開で読み、名前集合の差を取る。
4. **ワークフローの `paths:` も広げる**。今は `packages/{mulmoclaude,protocol,client,chat-service}` と
   `server/` `src/` `scripts/mulmoclaude/` だけなので、**common に export を足す PR では smoke が起動すらしない**。
   走査対象を増やしても trigger しなければ意味が無い。

## やらないこと

- `audit:releases` への一本化（案 c）。README だけの drift が 45 件出るので PR ゲートにならない。
  役割分担はそのまま: drift.mjs = 「export を足して version を据え置いた」の検出、
  audit:releases = tag 基準の棚卸し。
- 既存の判定語彙（`ok` / `pending-publish` / `drifted` / `skipped`）は変えない。smoke.mjs が読む。

## 検証

- 20 パッケージを新指標で測り、**DRIFTED が 0 件**（= 赤いゲートを landing させない）ことを確認してから push
- `parseExportedNames` を両方向でユニットテスト（`export {a, b as c} from`、`export const/function/class`、
  `export default` を名前に数えない、`export * from` は barrel として数え、読めれば両側で辿る）
- 既存 `test/scripts/mulmoclaude/test_drift.ts` の fixture ベースのテストを新形に移す
- local dist が無い場合は `skipped` + 理由（黙って pass しない）

## cross-review で出た 13 の追加穴（すべて再現してから修正）

どれも形が同じ — **間違った / 空の答えが clean と読まれる**:

1. **公開側 subpath の 404 が skip だった** → concrete target の 404 は drift（transport 失敗は skip のまま）
2. **非 JS target（`./style.css`）が「比較成功」に数えられていた** → 走査 20 のうち 8 個が該当。JS 未ビルドでも `ok` になり得た
3. **パーサが読めない名前を推測していた** → `export { a as "string name" }` が `a`、`export { café }` が `caf`
4. **opaque の fallback が名前比較を置き換えていた** / **ネスト条件と types のみの subpath** → 前者は 1 行対 1 行で clean、後者は別ファイルを比較
5. **`export * from` を列挙せず行数に落としていた** → 両側で辿るようにした（深さ 4 / cycle guard）。実ゲートの opaque entry は 0 になり、`core` の 33 entries も名前で比較される
6. **CJS entry が「0 名前 vs 0 名前 = 一致」だった** → `require` だけの subpath は `export` 文を持たないので skip + 理由。dual package は `import` 条件で比較されるので損失なし
7. **文字列内の `;` が文を捏造していた** → `export const a = "x;export const b = 1"` が 2 文に割れて存在しない `b` を drift として報告。`;` split / `,` 判定 / bracket 追跡を 1 つの文字列対応スキャナに寄せた。加えて **barrel walk 中の到達不能ファイルが「公開側に無い名前」= drift と読まれていた** → 404 は粗い比較に降格、transport 失敗は skip

3 回続けて「もう 1 つの形を落としている」と指摘されたので、**ルールを ban-list から許可リストに反転**した（文 / 指定子 / 宣言名 / 条件解決 / barrel 解決の 5 段）。安全なコードの一部も粗い比較に落ちるが、リリースゲートとしてはその取引が正しい。

8. **`require` 分岐が verdict に出ていなかった** → `exports` 条件は 1 subpath = 1 target で `import` が勝つため、走査対象の **48 subpath が持つ別の `.cjs`** は比較も言及もされていなかった。各行に `N require branch(es) NOT compared` を出すようにした。**パースはしない**（CJS reader の失敗形は「名前 0 個」= 今回潰した「両側 0 で一致」そのもの。実測: 8 行の reader で 48 のうち 10 が 0 名前 — rollup が `exports.x =` をカンマで連結するため）。ゲートは設計として ESM 専用で、それを verdict の場所に書いた。ESM 側の drift が強制する version bump は 1 ビルドが両形式を同じ entry から出すので両方を publish し直す

9. **version を上げただけ（export 差分なし）が release blocker になっていなかった** → `pending-publish` は `added.length > 0` のときだけ付いていたので、API 変更の無い patch は `ok` になり `--release` を通っていた。consumer のレンジは既に `^<local>` なので npm に無い version = ETARGET。実際に `@mulmoclaude/core@4.9.1` が clean と表示されていた。status を version だけで決める形に変更（PR では非 fatal、`--release` で fatal）
10. **公開済みファイルを指す新 subpath が clean だった** → local の `exports` map だけを列挙していたため、`{"./new": "./dist/index.js"}` は同じファイルを 2 回比較して一致。公開 `package.json` に key が無いので `import "pkg/new"` は install 後に失敗する。公開 manifest の subpath key も比較する（manifest が読めないときは「言えない」= 判定しない）
11. **同じ名前を出す barrel が 2 つあると union していた** → ESM は ambiguous な名前を公開しない（`import { x }` はエラー）。union は「importable でない名前」を報告し、かつ衝突が解消して importable になった変更を clean と言う。2 つ以上の barrel から来る名前は、barrel 自身が明示 re-export していない限り除外
12. **`require` の報告が nested 条件を見ていなかった** → `{ node: { import, require } }` は ESM に解決されるので、top-level だけ見る実装では何も報告されないまま CJS 分岐が未比較になる
13. **ファイル全体の brace カウンタが実在の export 行を飲み込んでいた（実 entry 2 件）** → 文の結合をファイル先頭からの brace 深さで行っていたため、文字列の中に brace が 1 つあると壊れる。`@mulmoclaude/core` の `./plugin-vue` dist は列 0 の export 行が 1 本（10 名前）だけで、それが前の行に結合され **両側 0 名前 = 一致** と読まれていた。結合を `export` 行から始める形に変更。効果は合計に出る: `core` 676 → 686、`shapescript-plugin` 47 → 62

テストは 81 件。実ゲートは 20 パッケージ / drifted 0 / exit 0（`--release` は 4 件 block）。各ガードは mutation で 10/10 赤を確認済み。

**パーサは外部の ground truth と突き合わせて判定している**。`scripts/mulmoclaude/drift-groundtruth.mjs` が走査対象の local dist entry を全部 `import()` して `Object.keys(namespace)`（Node が実際に公開する名前）とパーサの結果を比較する: **67 entry / 67 完全一致、取りこぼしも捏造も 0**。上の 13 番はこれで見つかった（パーサを読んでいるだけでは出なかった）。`yarn test` には入れない（ビルド済みコードの import は副作用がある）が、このパーサを触ったら手で回す。

残る制約は 1 つ、これも実測して残した: 複数行のテンプレートリテラル**内部**の列 0 `export` 行は文として読まれるので名前を捏造する。塞ぐガード（直前の backtick が奇数なら行を落として opaque）は **実 entry 6 件・数百の実在名前**を名前比較から落とす一方、67 entry の実測ではその形は 1 件も無い。捏造名は sample 自体が変わらなければ両側同じなので、最悪でも false `drifted` で、false `ok` にはならない。
