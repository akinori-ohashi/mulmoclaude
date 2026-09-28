# 削除件数の表示を実態に合わせる（#3260）

## 症状

`propagateDeletes` を有効にしたコレクションで push すると、Google から実際に
消えたのに「{localDeletes}件のローカル削除は**未反映**」と表示される。

## 原因

`CollectionView.vue:695` が4つしか読んでいなかった。#3247 で `deletedInGoogle` を
足し `pushWroteSomething` も数えるようにしたが、**文言を直していなかった**。

`localDeletes` は「こちらで何件消えたか」で伝播の有無で意味が変わらない。伝播した
分は `deletedInGoogle`。なので `localDeletes` をそのまま「未反映」と呼ぶのは、
オプトインした瞬間に嘘になる。

## 直し方

「未反映」の件数は **`localDeletes - deletedInGoogle`**。

文言は2種類に分け、**伝播していないときは今と同じ文**にする（オプトインしていない
大多数の表示を変えない）:

- `pushDone`（既存）— `deletedInGoogle === 0` のとき。この分岐では
  `deletesNotApplied === localDeletes` なので表示は不変
- `pushDoneWithDeletes`（新規）— `deletedInGoogle > 0` のとき。削除件数を含む

件数の導出は `calendarPushResult.ts`（既存の純粋モジュール）へ。remainder は
`Math.max(..., 0)` で下限を切る — 古いホストは `deletedInGoogle` を返さず、負の
件数はそのまま画面に出るため。

## 非目標

- 件数の常時5個表示。オプトインしていない利用者に `0 deleted in Google` は邪魔

件数の導出 **と文言の選択** は `calendarPushResult.ts`（既存の純粋モジュール）へ。
後者を SFC の中に残さないのが要点で、**`.vue` の中のメソッドはテストランナーが
読み込めない** — この境界にテストが無かった理由そのものがそれ。

## 検証

- `test/plugins/collection/test_calendarPushCounts.ts` — 件数の算術。伝播オフ /
  フィールド欠落 / 全部通った / 一部拒否 / 負にならない / 他3件の素通し、および
  `pushWroteSomething` と文言選択が一致すること
- `test/plugins/collection/test_calendarPushMessage.ts` — **挙動保存は差分で証明する**。
  旧コードの式をそのまま再現し、**実際の8ロケール辞書**で新旧を並べてレンダリングして
  一致を確認する。入力は生成で、明示的な `deletedInGoogle: 0` と、古いホストが返す
  **キー不在**の両方を含む。文を読んで確かめられる主張ではない
- **break-verify**: 常に `pushDone` を返す変異 / 生の `localDeletes` をスロットに渡す
  変異の両方で赤くなることを測り、変異対象が元に戻っていることを差分で確認する
- 8ロケールに `pushDoneWithDeletes` があり、5つのプレースホルダが揃うことを機械確認
