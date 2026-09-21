# feat(#3175): Claude Code プラグインのスキルも走査する

## 背景

`discoverSkills()` が見ているのは 2 か所だけ。

```
<claudeConfigDir>/skills/<name>/SKILL.md        ← user
<workspaceRoot>/.claude/skills/<name>/SKILL.md  ← project
```

Claude Code のスキル配布には**もう1つ標準経路**がある。`/plugin marketplace add` →
`/plugin install` で入るプラグインで、実体はここ:

```
~/.claude/plugins/installed_plugins.json
  { "version": 2, "plugins": { "<plugin>@<marketplace>": [{ "scope": "user", "installPath": "…", … }] } }
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
```

実機確認（2026-09-15, このマシン）: user scope 4 件が上記 ledger に載っており、うち
`swift-lsp@claude-plugins-official` は Anthropic 公式マーケットプレイス。`SKILL.md` の
frontmatter は user/project スコープと同形（`description:` のみ、名前はディレクトリ名）。

## この PR が変えること / 変えないこと

**変えない**: エージェントがスキルを呼べるかどうか。MulmoClaude は `claude` CLI を spawn し
`--allowedTools` に裸の `Skill`（= 全スキル許可）を渡すだけで、`server/agent/prompt.ts` は
スキル一覧を注入しない。**エージェント側の発見は CLI の仕事**で、CLI はプラグインのスキルを
元から読む。

**変える**: `discoverSkills()` の結果を使う MulmoClaude 自身の面。

| 面 | 場所 |
|---|---|
| スキル一覧 UI / manageSkills | `server/api/routes/skills.ts` |
| bridge `/help` の "Skills:" | `server/index.ts` |
| スキルのスケジューラ | `server/workspace/skills/scheduler.ts` |
| 呼び出しイベントへの path/description 付与（表示用） | `server/api/routes/agent.ts` |

issue の症状（`Skill` 呼び出しが 0 件）は Docker サンドボックスが原因の別問題と見ている
（ledger の `installPath` がホスト絶対パスで、コンテナの HOME は `/home/node` なので解決できない）。
報告者に確認中。**この PR はその症状を直さない。**

## 決定

1. **スキル名は `<plugin>:<skill>`**。CLI の Skill ツールがこの形で addressing する
   （`ever-better:ever-better-drain`）。スケジューラと manageSkills の Run はどちらも
   `/${skill.name}` を送るので、名前を CLI に合わせないと押せても動かない。
   `<plugin>` は ledger キー `<plugin>@<marketplace>` の `@` より前（`lastIndexOf`）。
2. **優先順位は project > user > claude-plugin**。既存のスキルを奪わない。
3. **`enabledPlugins` を尊重する**。`settings.json` で明示的に `false` のプラグインは除外。
   user → workspace `.claude/settings.json` → `.claude/settings.local.json` の順にマージし、
   マージ後の値が `false` のキーだけを落とす（キー不在は「有効」扱い — install は `true` を書くので不在は編集/破損由来）。
4. **`SkillSource` に `claude-plugin` を追加**し、読み取り専用として扱う。
5. **ledger は壊れていても例外を投げない**。CLI の内部状態ファイルで公開 API ではなく、
   すでに `"version": 2` を持つ（一度形が変わっている）。型ガードで読み、想定外は黙って捨てる。

## プラグインのスキルを渡さない呼び出し元（理由付き）

実測で**プラグインのスキルは 1116 件**あった（このマシン、3 プラグイン）。全部を無条件に流すと
壊れる面があるので、2 か所は明示的に opt-out する。

- **bridge の `/help`**（`server/index.ts`）: スキル 1 行ずつを**1 通のチャットメッセージ**に詰めて送る。
  1116 行はどのブリッジのメッセージ上限も超える。同じ理由でブリッジのスラッシュコマンド
  allowlist にも載らない。
- **スキルのスケジューラ**（`workspace/skills/scheduler.ts`）: マーケットプレイスの
  プラグインを入れただけで、その frontmatter の schedule が**定期実行として自動登録される**のは
  ユーザーが頼んでいない挙動。
- **writer の 3 呼び出し**（`workspace/skills/writer.ts`）: 下の「触らないと決めたもの」のとおり
  writer に到達し得ないうえ、読むとテストがマシンの導入済みプラグインに依存する。

UI 側は件数が多くても一覧なので出す。ただし**並び順は「ユーザーのスキルが先、プラグインは後」**に
する（`compareSkillsForSidebar`）。これをやらないと `pickInitialSelection` が拾う先頭行が
プラグインのスキルになり、開いたときの既定選択が変わってしまう。

## 触らないと決めたもの（理由付き）

- **`writer.ts` の `source === "user"` ガード**。`update`/`delete` はどちらも先に
  `isValidSlug(name)` を通し、slug は `:` を許さない（`server/utils/slug.ts`）。よって
  `plugin:skill` 名は writer に到達しない。`!== "project"` に広げても**到達しないコード**が増える
  だけで、返る `kind: "user-scope"` はプラグインスキルに対しては誤った名前になる。
  到達可能性が変わるのは命名規則を変えたときだけなので、その時に一緒に直す。
- **`saveProjectSkill` の重複チェック**。`discoverSkills()` 全体を見るので prefix 付きの
  プラグインスキルも自動的に考慮されるが、slug が `:` を許さないので実際には衝突しない。

## 変更ファイル

```
server/utils/claudeConfigPath.ts          claudeSettingsPath / claudePluginLedgerPath
server/workspace/skills/claude-plugins.ts 新規: ledger と enabledPlugins の純粋パーサ + 読み出し
server/workspace/skills/paths.ts          プラグイン側のパス定数
server/workspace/skills/types.ts          SkillSource += "claude-plugin"
server/workspace/skills/discovery.ts      3 つ目のルート + collectSkillsFromDir に namePrefix
server/api/routes/agent.ts                SkillMetadata.scope を SkillSource ベースに
src/types/session.ts                      SkillScope += "claude-plugin"
src/utils/agent/parseSseEvent.ts          isSkillScope
src/composables/useSkillsList.ts          source union
src/plugins/manageSkills/index.ts         source union
src/plugins/manageSkills/categories.ts    provenance + バッジ + 並び順
src/plugins/manageSkills/View.vue         並び順を compareSkillsForSidebar に委譲
src/lang/*.ts (8)                         sourceClaudePluginTitle
README.md + README.*.md (8)               スコープ表に 3 行目
test/skills/test_claudePlugins.ts         新規: 純粋パーサ（正常・異常・境界）
test/skills/test_discovery.ts             3 スコープの優先順位と prefix
test/plugins/manageSkills/test_categories.ts  provenance / バッジ / 並び順
```

## Codex cross-review round 1 で変えたこと

3 件（P2 2 / P3 1）。いずれも**同じラウンド内で**代替案を Codex に投げ返して合意済み。

1. **ledger の `installPath` を検証していなかった**（P2）。絶対パス かつ `.`/`..` セグメント無し
   だけを使う（既存の `hasTraversalSegment` を再利用）。弾いたら key とパスを warn。
   **プラグインキャッシュ配下への封じ込めはしない** — `claude plugin marketplace add` は
   "URL, path, or GitHub repo" を受けるのでキャッシュ外の installPath は正当な形であり、
   封じ込めるとプラグイン開発者のプラグインを黙って落とす。そもそも ledger を書ける相手は
   同じディレクトリの `settings.json`（エージェントの permissions）も書けるので封じ込めは何も買わない。
   symlink 追従も user スコープの設計どおりなので変えない。
2. **既定の `discoverSkills()` が毎回プラグインを全スキャンしていた**（P2）。実測 11-18 ms →
   179-204 ms（3 プラグイン / 1116 件 / warm）。**キャッシュは入れず**、名前で引く 2 か所
   （`resolveSkillMetadata`、`GET /api/skills/:name`）が `:` を含まない名前ではプラグインを
   スキャンしないようにした（`couldBeClaudePluginSkill` + `PLUGIN_NAMESPACE_SEPARATOR`）。
   残る呼び元は 2 つの一覧ビューだけで、どちらもユーザー操作起点。キャッシュは「無効化なしで常に最新」
   というこのモジュールの性質を壊す。
3. **サイドバーの凡例が provenance 3 種しか説明していなかった**（P3）。8 ロケールに
   `{claudePlugin}` を追加 + View.vue にスロット。`test/lang/test_skill_legend_placeholders.ts` で
   「全ロケールに 4 スロット」かつ「スロット数 == `skillBadgeMeta` が返す provenance 数」を固定。

## round 2-3 で変えたこと — 「2 スコープ」という主張が 15 か所に書かれていた

round 2 は P3 1 件（スコープ表の下の「両スコープとも読み取り専用」）、round 3 は P3 1 件だが
**サイトを全部列挙した形**で来た。合わせて 15 か所。1 つの主張を 15 か所に書き写していたので、
スコープを 1 つ足した瞬間に 15 か所が同時に嘘になった、というだけの話。

直し方を 2 つに分けた：

- **読者の道案内でしかない文**（`skills/paths.ts` の冒頭、`api/routes/skills.ts` の冒頭、
  `manageSkills/meta.ts` の route コメント、`docs/extension-mechanisms.md`）は、
  一覧を書き写すのをやめて **`discovery.ts` が単一の source of truth** だと指すだけにした。
  次にスコープが増えても陳腐化しない。
- **読者や**モデル**が行動の根拠にする文**（`manageSkills/definition.ts` のツール説明と
  update/delete プロンプト、8 ロケールの Delete 段落、スコープ表の下の文）は、
  スコープを数える形をやめて「**書けるのは project だけ、他は読み取り専用**」という形にした。

`definition.ts` は**モデルが読むプロンプト**なので、ここが古いままだと
「プラグインの skill を削除して」と言われたエージェントが誤った前提で動く。15 か所の中で
唯一、実行時の挙動に触るサイト。

なお round 2 の書き直しで自分が入れた「Skills ビューから作成できる」は**嘘**だった
（`src/` に create エンドポイントの呼び出しは無く、作成は chat の manageSkills ツールか
カタログの★経由）。Codex が見る前に自分で見つけて直した（c3915da9c）。

## 検証（実施済み・2026-09-15）

- `yarn format` → `yarn build:packages` → `yarn typecheck`(exit 0) → `yarn lint`(0 errors /
  既存 warning 46・変更ファイルは 0) → `yarn test`(fail 0) → `yarn build`(exit 0)
- 型ユニオンを広げる変更なので、網羅していないガードは typecheck が落として教える
- **break-verify**: round 1 で足したガードと凡例テストは、それぞれ実装を外すと赤になることを確認
  （installPath ガード削除 → 新規 2 件が fail / ko.ts から凡例の一文を削除 → 8 pass 1 fail。
  どちらも復元はバイト一致）。最初に書いた traversal のテストは `path.join` が `..` を
  正規化してしまい何も検証していなかったので、リテラル文字列に直した。
- **実機**: 実際の `~/.claude/plugins/` に対して `discoverSkills()` を実行し、
  `claude-plugin: 1116` / namespaces `ever-better, mulmocast, tne` を確認。
  CLI 自身のスキル一覧に出る `mulmocast:story` / `ever-better:ever-better` /
  `ever-better:ever-better-drain` / `tne:bod14-collect-reports` が**同じ名前で**見つかった
  （外部の ground truth = CLI の一覧との突き合わせ）。`swift-lsp` は skills を持たないので 0 件。
