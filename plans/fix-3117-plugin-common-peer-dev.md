# fix(deps): plugin の `@mulmoclaude/common` を peer + dev に揃える (#3117)

`@mulmoclaude/core` は 8 plugin で `devDependencies` + `peerDependencies` に揃っているのに、
`@mulmoclaude/common` は 6 plugin が `dependencies` で宣言していた。CLAUDE.md の規則:

> A plugin declares host-provided packages as `peer` + `dev` — never `dependencies`.
> `dependencies` makes npm install a **second copy nested under the plugin**, so the plugin
> and the host each get their own module instance.

launcher 自身が `@mulmoclaude/common` を宣言しているので common も host 提供 package。
**方針 (a)**（ユーザー判断 2026-09-13）: 規則の文面は変えず、**6 つを core と同じ形に揃える**。

## 現状 → 目標

| plugin               | 現状                                           | 目標                                                |
| -------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `x-plugin`           | `dependencies: ^1.3.0`                         | `peerDependencies` + `devDependencies`              |
| `accounting-plugin`  | 同上                                           | 同上                                                |
| `html-plugin`        | `dependencies` **と** `devDependencies` の両方 | `dependencies` を削り peer を追加（dev は既にある） |
| `mulmoscript-plugin` | `dependencies: ^1.3.0`                         | `peerDependencies` + `devDependencies`              |
| `spotify-plugin`     | 同上                                           | 同上                                                |
| `markdown-plugin`    | 同上                                           | 同上                                                |

**`dependencies` から消すだけでは駄目**（import しているものが未宣言になる）。CLAUDE.md が
明記しているとおり、**peer への追加と dev への追加が対になる**。6 つとも実際に src から
common を import している（`@mulmoclaude/common` を含むファイル数で 3 / 9 / 2 / 10 / 3 / 2、
うち実際の import 文を持つのは 2 / 9 / 2 / 10 / 2 / 2 — 残りはコメント言及）。

**逆方向も確認した**: manifest を持つ 17 plugin を実 import パターン（`from` / `import` /
`require(` + 文字列）で走査し、common を実 import しているのは**この 6 つだけ**、宣言だけ
あって import が無いものも無し。`shapescript-plugin` は `src/core/contract.ts:9` の doc
コメントで言及しているだけで実 import は無い。

## 検証すること

- `check:launcher-sync` の "no peer-dep violations" — launcher は `@mulmoclaude/common: ^1.3.0` を
  宣言しているので新しい peer（`^1.3.0`）を満たす。**これが唯一の機械的ゲート**
- lockfile が変わらないこと（workspace 内部解決なので変わらない見込み。変わったら
  クリーン install で検証する — 温かい `node_modules` は嘘をつく）
- 6 plugin が standalone でビルド/テストできること（dev 宣言がそれを担保する）
- 各 plugin の build + typecheck + test

## cross-review で出た論点（round 1）

### 第二の host（`mulmoterminal`）は peer を満たすのか

Codex の P2。CLAUDE.md は host を **2 つ** 名指ししている（`mulmoclaude` と `mulmoterminal`）のに、
この PR が証明しているのは launcher 側だけ、という指摘。実測すると:

|                                           |                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receptron/mulmoterminal` の直接宣言      | 影響する 6 plugin のうち **5 つ**（accounting / html / markdown / mulmoscript / x）と `@mulmoclaude/core: ^4.9.0`。**`@mulmoclaude/common` の直接宣言は無い** |
| `@mulmoclaude/core@4.9.0`（公開版）の宣言 | `@mulmoclaude/common: ^1.2.0`（`dependencies`）                                                                                                               |
| npm 上の `@mulmoclaude/common` 最新       | **1.2.0**                                                                                                                                                     |
| 公開中の 6 plugin の宣言                  | `^1.2.0` / `^1.1.2` / `^1.1.1`（すべて `dependencies`）                                                                                                       |

**解決する**。理由は semver の 1 系キャレット: `^1.2.0` は **1.3.0 を満たす**（`^0.23.0` が 0.24.0 を
満たさないのとは逆。CLAUDE.md の 0.x 固有の記述と混同しないこと）。したがって
`common@1.3.0` が publish された後は `mulmoterminal → core@^4.9.0 → common@^1.2.0` が 1.3.0 に
解決し、hoist された 1 本が plugin 側の peer `^1.3.0` を満たす。

**publish 順の前提を明示する（round 2 で自分の主張を訂正）**: 最初「2 つのゲートが
plugin の publish 自体を block するので危険な窓は無い」と書いたが、**これは言い過ぎ**だった。
実際に読むと:

| ゲート                                                            | 実際の走査範囲                                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:published-deps`（`scripts/mulmoclaude/publishedDeps.mjs`） | **launcher の manifest だけ**（`packages/mulmoclaude/package.json`）。今 exit 1 になるのは launcher が `common: ^1.3.0` を宣言しているからで、**plugin の peer 下限は見ていない**                  |
| `drift.mjs --release`                                             | workspace 自身の export と version のずれを見るゲート。#3116 で 20 workspace に広げたが、**plugin の peer 下限が npm に存在するかは見ていない**。そもそもこのブランチにはまだ #3116 が入っていない |
| `/publish` skill                                                  | 「dependency order で回す」という**手順の指示**であって機械的ゲートではない                                                                                                                        |
| `/publish-mulmoclaude` skill                                      | 上の 2 つを走らせるが、これは **launcher を publish するとき**の流れ                                                                                                                               |

つまり **plugin の publish は、peer 下限が npm に存在することを機械的に検証されていない**。
守っているのは CLAUDE.md の「Publish order — always bottom-up, launcher last」という順序規則。

**したがって前提条件として明記する**:

> この 6 plugin のどれかを publish する前に、**`@mulmoclaude/common@1.3.0` を先に publish する**こと。
> `^1.3.0` の peer は npm に 1.3.0 が存在しない限り満たせない。これは bottom-up の publish 順
> （common → plugins）そのものなので新しい制約ではないが、機械的に止まるものではないので
> 手順として書いておく。

**残る前提を明記する**: この解決は **hoist される flat な tree**（npm / yarn v1）か
**pnpm の `auto-install-peers`（v8 以降の既定 on）** に依存している。strict で非 hoist、かつ
auto-install-peers を切った構成では plugin の peer は未充足になる。恒久的な対処は
`mulmoterminal` 側で `@mulmoclaude/common` を直接宣言することで、それは**あちらのリポジトリの
変更**なので本 PR には含めない（フォローアップとして提案する）。

### rule の rationale は common には効かない（測定済み）

CLAUDE.md が書く失敗形は「core が module state に持つもの（registries / watchers / caches）が
二重に存在する」。`@mulmoclaude/common` はそれに当たらない:

- `src/*.ts` 6 ファイルすべてで **module-level の `let` / `var` が 0 件**
- `dependencies` / `peerDependencies` が **どちらも空**
- module-level のコレクションは `HTML_ESCAPES` / `ALLOWED_PROTOCOLS` / `BLOCKED_HOSTNAMES` の
  読み取り専用ルックアップのみ

純関数パッケージの二重コピーは実行時には無害なので、この PR の実際の利点は別の 3 点:

1. `core` と同じ形に揃えて、配置の判断を per-package にしない
2. nested な二重コピーが消えて install が小さい
3. host が古いとき、nested コピーで silent に動くのではなく **loudly に壊れる**
   （`asInt` / `PORT_RANGE` は 1.3.0 で足したばかりなので、これは実利がある）

## この PR でやらないこと

- **規則の文面は変えない**。判定基準（module state / singleton 要求）を書き足す案 (b) は採らない
- **publish はしない**。配置変更は各 plugin の次の publish でユーザーに届く。
  それまで npm 上の 6 つは `dependencies` のまま = 現状と同じ挙動
