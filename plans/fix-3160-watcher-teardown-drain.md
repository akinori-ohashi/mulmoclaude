# fix(#3160): watcher の teardown が event 駆動の reconcile を待ち切る

## 症状

`lint_test (22.x, macos-latest)` が `test_watcher.ts` でたまに落ちる。

```
not ok 3 - clears entries when completionField is removed from the schema
  test/workspace/collections/test_watcher.ts:214  →  2 !== 1
```

他の3マトリクスは同じコミットで成功。再実行で緑。

## 調査

再現試行は macOS 実機で30回（単体20 + collections 一括10）— **すべて pass**。フレークを待ち伏せても出ない。

代わりにコードを読んで**非対称**を見つけた。`stopGeneration` は in-flight を2種類待つが、3種類目を待たない:

```js
await gen.bootInFlight?.catch(() => {});   // 待つ
await gen.triggerTickInFlight;             // 待つ
gen.alive = false;
gen.itemSlots.clear();                     // clear するだけ — 走っている pass は止まらない
```

`gen.alive` の実行時チェックは**クロックティック経路の1箇所だけ**で、ファイル監視イベント経路には無い。
`runSingleFlight` の pass も alive を見ず、`Map.clear()` は走行中の promise をキャンセルしない。

## 決定的に再現させた

フレークを待たず、**窓を意図的に開けた**。reconcile を開始して await せずに teardown し、
次のテストの `beforeEach` がやるとおり notifier のパスを張り替えてから、置き去りの pass を完走させる:

```
PROBE leaked-into-next-test = 1
```

notifier のパスはモジュールグローバルなので、**置き去りの pass の書き込みは次のテストのファイルに落ちる**。
次のテスト自身の1件と合わせて 2。observed の `2 !== 1` と一致する。

macOS だけで出るのは FSEvents の配送が inotify より遅く・合体しやすく、窓が開きやすいため。
負荷が要るのは await が伸びて窓が広がるため。クリーンな30回で出ないのは窓が開かないため。

## 修正

`stopGeneration` が、watcher を unsubscribe した**後**に in-flight の item / collection slot を待ち切る。

unsubscribe を先に済ませるのが**この待ちを有界にする**。新しいイベントが slot を延命できない。

## テストは「契約」を固定する（「漏れ」ではなく）

「漏れていない」は sleep のあとでしか確認できず、意味のある長さの sleep は同時にフレークの原因になる——
**まさにこのバグの種類**。同じ性質を待たずに観測できる形に言い換えた:

> teardown は、pass が走っている間は return しない

変異確認: drain を外して **dist を作り直すと**そのテストだけ赤、戻すと緑。

**dist の作り直しが要る**のは、テストが `packages/core/dist` を解決するため。
最初これを忘れて、変異が届かず「緑のまま」を見た。src を変えただけでは届かない。

## スコープ外

- `packages/core` の npm publish（この repo 内はワークスペース参照なので即時反映される）
- `runSingleFlight` 側に alive チェックを足す案（②）。teardown 側で不変条件を1箇所に言うほうを採った
