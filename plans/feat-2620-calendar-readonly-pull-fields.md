# feat(calendar): pull で読めるだけの read-only フィールドを純加算する (#2620)

## Request

「やれることは #2620 の中で進める。互換性とか、副作用があるものは見送り」

#2620 は6項目の要望として出され、双方向同期を成立させる3点は PR #2666 で入っている
（`description` / `location` の往復、`autoPush`、map 外の列の保護）。残り3項目は
「別 issue で純加算する」と issue 上で報告者 michiof に約束したまま、どこにも立っていない。

このうち **副作用ゼロで入るものだけ** をここで入れる。

## 副作用の有無で仕分ける

判定基準は一つ: **既存のコレクションの挙動が、ユーザーが `map` を書き換えない限り変わらないか。**

### 入れる — pull 専用・スカラ・Google 側で read-only

| フィールド | Google の型 | 取り方 | #2620 の項目 |
|---|---|---|---|
| `recurringEventId` | string | `stringField` | 1（展開インスタンスの親シリーズを指すキー） |
| `originalStartTime` | `{dateTime,timeZone}` / `{date}` | 既存の `eventTime` | 1（移動されたインスタンスの元位置） |
| `updated` | string (RFC3339) | `stringField` | 2 必須の残り |
| `transparency` | string | `stringField` | 2「あると良い」 |
| `eventType` | string | `stringField` | 2「あると良い」 |
| `hangoutLink` | string | `stringField` | 2「あると良い」 |

副作用が無い根拠:

- `PUSHABLE_SOURCE_FIELDS`（`pushPlan.ts`）は触らない。`pushableMap` が map を push 可能な
  ものだけに絞るので、新フィールドを map に書いても push は一切見ない
- `ShadowEvent`（`calendarPushState.ts`）は `Pick<CalendarEventSummary, push 可能な6つ>` で、
  `toShadowEvent` も6つを明示列挙している。**read-only フィールドはベースラインに入らないので
  `.push-state.json` の移行が発生しない**（アップデート直後に全件が「編集済み」に化ける事故が起きない）
- `GOOGLE_CALENDAR_SOURCE_FIELDS` は `map` の **値** の `z.enum`。列挙を広げるのは既存スキーマに
  対して後方互換（受け付ける値が増えるだけ）
- 既存コレクションは、ユーザーが `map` に足すまで何も変わらない

### 見送る — 副作用か、設計判断が必要

| 見送るもの | 理由 |
|---|---|
| `attendees`（`self.responseStatus`） | 配列。1列のスカラにどう畳むかは挙動の設計判断で、純加算ではない |
| `conferenceData.entryPoints[].uri` | 入れ子の配列。同じ理由。`hangoutLink` が実用上の代替になる |
| ローカル削除の GCal への伝播（項目6） | 不可逆で、他人が読むカレンダーに書く。まさに副作用 |
| 新フィールドを push 可能にする | `ShadowEvent` が広がってベースライン移行が発生する。**read-only に留めることがこの PR の副作用ゼロの根拠そのもの** |

## 実装

1. `CalendarEventSummary`（`calendar.ts`）に6フィールドを追加。すべて `string`。
   `toCollectionRecord` が `event[source]` で引くので、スカラ以外は型が通らない
2. `toEventSummary` で射影。`originalStartTime` だけ既存の `eventTime` を通す
3. `GOOGLE_CALENDAR_SOURCE_FIELDS`（`schemaZ.ts`）に6つ追加
4. ドキュメント
   - `google-calendar-collection.md` — マップ可能フィールドの一覧、および
     「push は pull が読めるもの全部から `htmlLink` と `status` を除いたもの」という
     文の除外リストを広げる
   - `collection-skills.md` の一覧は **#2666 の時点ですでに古く** `description` / `location` が
     載っていない。エージェントが「description は map できない」と読む load-bearing な誤りなので
     ここで直す

## 検証

- `toEventSummary` の形を固定しているテスト（`test_googleCalendar.ts` の `emptyEvent` deepEqual）が
  新フィールドを要求するので、そこが通ることが射影の担保
- 追加するテスト: 展開インスタンス（`recurringEventId` + `originalStartTime` 付き）の射影、
  `originalStartTime` の終日形（`{date}`）、欠損時に `""` になること
- **push が新フィールドを見ないことをテストで固定する** — `pushableMap` に read-only フィールドを
  含む map を渡して、絞り込まれた結果に現れないこと。これがベースライン移行不要の根拠の実行可能な形
- 機械の負荷が高い（load average が core 数に張り付いている）ため、ゲートはローカルで回すが
  CI を ground truth とする

## やらないこと

この PR は #2620 を閉じない。見送った3件（`attendees` / `conferenceData` / 削除の伝播）は
別 issue に切り出す必要があり、それは #2620 のクローズと合わせて別途。
