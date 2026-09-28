# 終日イベントを作れるようにする（#3240）

#2620 のコメントで @michiof さんが「高」に挙げた唯一の項目。終日で1日1件を登録する
運用のカレンダーが、claude.ai の Google Calendar コネクタ頼みで残っている。

## 調べて分かったこと

Google API を叩く層（`packages/core/src/google/calendar.ts`）は既に終日を表現できる。
`CalendarEventTime` が `{ date }` を持ち、`resolveEventSpan` / `eventEnd` がそれを
そのままボディに載せる。塞がっているのは**引数の検証面だけ**。

| 経路 | 状態 |
| --- | --- |
| `google` ツール（`packages/plugins/google-plugin/src/args.ts`） | `IsoDateTimeWithOffset` で日付のみを弾く |
| remote-host（`server/remoteHost/handlers/googleCalendar.ts`） | 同じ検証で弾く |
| push の新規レコード（`pushDateTime.ts`） | 裸の日付が来れば `{ date }` を返す（＝`date` 型の列にマップすれば通る） |

push の経路は `toGoogleEventTime` → `rawGoogleTime` → `isCalendarDate` で既に成立している。
`projectValue` が正規化するのは `datetime` 型の列だけなので、`date` / `string` 型の列に
マップした `start` / `end` は裸の日付のまま push に渡る。

## 決めごと

1. **終日の `end` は EXCLUSIVE のまま素通し。** 呼び出し側の値を変換しない。
   `toEventSummary` は Google の生の `end` を返し、`allDayFrom` もそれを往復させている。
   書き込みだけ inclusive にすると、読んで書き戻すたびに1日ずつ縮む。
   代わりに `end <= start` をその場で弾き、「1日だけなら end は翌日」と伝わる文面を返す。
2. **両端は同じ種類。** 日付のみと offset 付き date-time の混在を弾く。
   `calendarUpdateEvent` は片側だけ日付のみも弾く（格納値の種類が分からないため）。
3. **`datetime` 型の列から終日を作る道は作らない。** 判別材料が `T00:00` しかなく、
   正真正銘の 0:00 開始イベントと区別できない。既存挙動の破壊になる。

## 実装順

1. `packages/core/src/google/eventSpanInput.ts`（新規・純粋関数）
   - `isCalendarDateOnly(value)` — `YYYY-MM-DD` が実在する日か
   - `toEventTimeInput(value)` — 日付のみ → `{ date }` / offset 付き → `{ dateTime }` / それ以外 → null
   - `resolveSpanInput({ start, end })` — 両端の種類一致と `end > start` を含めた判定。
     失敗は理由の文字列を返し、呼び出し側がそのままメッセージにできる形にする
   - `resolveOptionalEnd(...)` — update の片側だけ指定を扱う
2. `packages/core/src/google/index.ts` から re-export
3. `packages/plugins/google-plugin/src/args.ts` — `start` / `end` の検証を差し替え、
   混在・逆転を `.refine` で弾く
4. `packages/plugins/google-plugin/src/core/dispatch.ts` — flat な `startDateTime` /
   `endDateTime` ではなく構造化した `start` / `end` を渡す
5. `server/remoteHost/handlers/googleCalendar.ts` — 同じ規則
6. `packages/plugins/google-plugin/src/definition.ts` — ツール説明
7. テスト（`test/services/google/test_eventSpanInput.ts` ほか）
8. ドキュメント（`helps/google.md` / `helps/google-calendar-collection.md`）

## 検証

- `test/services/google/test_pushDateTime.ts` に「baseline 無し + 裸の日付 → `{ date }`」を追加
- `test/services/google/test_googleCalendar.ts` に create/update のボディ確認を追加
- `packages/plugins/google-plugin/test/test_args_validation.ts` に受理/拒否の表を追加
- `test/remoteHost/test_googleCalendarHandlers.ts` に同等を追加
