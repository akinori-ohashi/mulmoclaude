# fix(scheduler): interval スケジュールをエポック基準の window 判定に直す (#2937)

## 問題

`packages/core/src/scheduler/task-manager.ts` の `isDue()` は interval を
**「当日 UTC 0時からの経過ms」** で判定している:

```ts
const msSinceMidnight = now.getUTCHours() * ONE_HOUR_MS + ...;
const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
return rounded % schedule.intervalMs === 0;
```

`msSinceMidnight` は `[0, 86_400_000)` に収まり毎日 0 にリセットされるため:

- `intervalMs >= 24h`: `rounded % intervalMs === rounded` となり 0 になるのは
  `rounded === 0` のときだけ → **設定値に関係なく毎日 UTC 0:00 発火**
- **24h を割り切らない interval**（7h, 50m 等）も日付をまたぐたびに位相がリセットされ、
  深夜に区間が縮む
- 正しく動くのは 24h を割り切る値（1h/6h/30m…）と 24h ちょうどだけ

実コード（`collectDueTasks`）を tick=1分・21日分で回した実測:

| schedule | 現状の発火回数/21日 | エポック基準 |
| --- | --- | --- |
| 168h (週1) | 21（毎日 00:00） | 3 |
| 48h | 21 | 10 |
| 24h | 21 | 21 |
| 7h | 84 | 72 |
| 6h | 84 | 84 |
| 50m | 609 | 605 |
| 30m | 1008 | 1008 |

さらに、**発火判定と「次回実行」表示が別実装**になっている:

- 発火 = `task-manager.ts` の `isDue()`（当日0時基準・バグ）
- `nextScheduledAt` / catch-up = `adapter.ts` → `@receptron/task-scheduler` の
  `nextWindowAfter()`（エポック基準・正しい）

`@receptron/task-scheduler` は本モノレポの workspace (`packages/scheduler`) で、
`nextWindowAfter` と整合する正しい tick 判定 `isDueAt()` を既に export しているのに、
ホスト側がそれを使わず独自実装していた（重複実装のドリフト）。

## 方針

**ライブラリの `isDueAt()` に寄せて重複実装を消す。** 発火・次回表示・catch-up が
すべて同じ window 定義（エポック基準）を共有する状態にする。

1. `packages/core/src/scheduler/schedule-window.ts`（新規・純関数）
   - `toLibrarySchedule(schedule)`: ホストの `{intervalMs}` → ライブラリの `{intervalSec}`
     変換。`adapter.ts` の private `toCoreSchedule` を昇格して単一実装にする
     （`Math.round` をやめ ms を保存する。1000 未満で `intervalSec: 0` → 0除算 → NaN →
     `new Date(NaN).toISOString()` throw だった経路も消える）
   - `isScheduleDueAt(schedule, nowMs, tickMs)`: `isDueAt()` への薄い委譲 + 不正値ガード
   - `unfireableScheduleReason(schedule)`: 「絶対に発火しない」スケジュールの理由
     （daily の非 HH:MM に加え、interval の非有限/0以下も対象にする。#2765 の教訓）
2. `task-manager.ts` の `isDue()` / `dailyTargetMs()` / `unfireableDailyTime()` を
   上記に置き換える
3. `adapter.ts` の `toCoreSchedule` を共有ヘルパに置き換える

daily 分岐は**挙動不変**（現行 `rounded === targetMs` と `isDueAt` の
`window ∈ (now-tick, now]` は同じ区間）。差分ハーネスで新旧を突き合わせて証明する。

## 挙動の変化（意図した変更）

- `interval Nh` はエポック基準の window で発火する（例: 168h → 木曜 00:00 UTC。
  epoch 1970-01-01 が木曜のため）。これは既に UI に表示されている `nextScheduledAt`
  と一致する値なので、表示と実挙動の不一致も同時に解消する
- 24h 未満で 24h を割り切る interval（1h/6h/30m…＝ビルトインのシステムタスク全て）は
  発火時刻が変わらない

## 影響範囲

- スキル frontmatter `schedule: interval Nh`
- ユーザータスク / automations MCP の `{type:"interval", intervalMs}`
- プラグインの periodic tick
- ビルトインのシステムタスクは 1h / 6h のみなので発火時刻は変わらない
- `@mulmoclaude/core` は MulmoTerminal も参照するため、同じ修正がそちらにも効く

## テスト

- `packages/core/test/scheduler/test_schedule_window.ts`（新規）: 純関数の単体テスト
  （変換、daily/interval の due 判定、不正値、境界）
- `packages/core/test/scheduler/test_scheduler.ts`: `collectDueTasks` 経由で
  168h / 48h / 7h / 6h / daily を tick 走査し、発火回数と発火時刻を検証
- 差分ハーネス（使い捨て）: 旧 `isDue` をコピーして新実装と全 tick 突き合わせ
  - daily: 完全一致すること
  - interval: ライブラリの `isDueAt` と完全一致すること（外部 ground truth）

## やらないこと（フォローアップ候補）

- **downtime 中の window の取りこぼし**: スキル/ユーザータスクには catch-up が無いため、
  エポック基準にすると発火時刻にサーバが落ちていた週はスキップされる。`lastRunAt` 基準の
  判定や、スキル/ユーザータスクへの catch-up 適用は別 issue にする
- 「毎週◯曜日」を指定したいニーズ向けの `weekly` スケジュール対応（ライブラリ側には型が
  あるが、ホストの parser / UI が未対応）
- npm 公開（`@mulmoclaude/core` の再公開）は別 PR
