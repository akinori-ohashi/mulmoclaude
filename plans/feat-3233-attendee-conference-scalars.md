# attendees / conferenceData を1列に畳む（#3233）

#2620 の項目2「あると良い」のうち、配列・入れ子ゆえに見送った2つ。@michiof さんの
優先度は「低」で「急ぎません」。

## なぜ map できなかったか

`map` の値は `CalendarEventSummary` のキーで、`toCollectionRecord` は `event[source]` を
引いて1つの値を書く。コレクションのフィールドはスカラなので、`attendees`（配列）と
`conferenceData`（オブジェクトの中の配列）はそのままでは載らない。

型の制約ではなく **どう畳むかが未決** だった。

## 採った案（issue の案 A）

射影の時点でスカラに畳む read-only の派生フィールドを2つ足す。

| 名前 | 元 | 値 |
| --- | --- | --- |
| `selfResponseStatus` | `attendees[]` の `self === true` の `responseStatus` | `needsAction` / `declined` / `tentative` / `accepted` / `""` |
| `conferenceVideoUri` | `conferenceData.entryPoints[]` の `entryPointType === "video"` の `uri` | URL / `""` |

案 B（`table` フィールドに載せる）は**単体では用途を満たさない** — `where.ts` の
`resolveValue` はレコード最上位のフィールドしか解決しないので、テーブルの行に対して
`flag` を書けない。A と排他ではないので、参加者一覧そのものが要るという要望が出てから
足せばよい。

## 決めごと（issue のチェックリストへの回答）

1. **`selfResponseStatus` の名前** — そのまま。誰の・何のステータスかが名前で分かる
2. **自分が参加者に居ない予定の値** — **`""`**。#3229 の `transparency` と同じ形
   （Google が返さなかった、という意味）。`""` は例外ではなく**多数派**で、参加者のいない
   自分だけの予定は全部これになる。だからフィルタは `!= "declined"` で書く。
   `== "accepted"` だと自分だけの予定が全部落ちる — ドキュメントに明記した
3. **`conferenceUri` を入れるか** — 入れる。issue のタイトルが両方を挙げているため。
   `hangoutLink`（#3229）は Meet 専用で、Zoom / Teams のカレンダーには届かない
4. **どの entry point を選ぶか** — **`video` のみ**。`phone` / `more` にはフォールバック
   しない。「会議に入る URL」という名前の列が時々 `tel:` を持つより、空の方がまし
   （呼び出し側が空を見て分岐できる）。名前も `conferenceUri` ではなく
   **`conferenceVideoUri`** にした — 何が入っているかが名前で分かる
5. **参加者一覧そのもの（案 B）** — 入れない。上記の理由
6. **`organizer` / `creator`** — 入れない。要望が出ていないため

## 純加算であることの担保

- `PUSHABLE_SOURCE_FIELDS` に入れないので push には乗らない
- `ShadowEvent` は pushable 側から導出しているので `.push-state.json` の移行は不要
- `pushPlan.ts` の `UNPUSHABLE_EVENT_FIELDS` は `Omit<CalendarEventSummary, keyof ShadowEvent | "id">`
  型なので、pushable にせずフィールドを足すとビルドが落ちる。実際に落ちたので2つ足した
  （この型ガードが効いていることの確認になった）

## テスト

- `test/services/google/test_eventDerived.ts`（新規）— 畳み方、`""` の意味、Google が
  送らない形（null / 文字列 / 配列でない）への耐性、`toEventSummary` が実際に呼ぶこと
- `test/workspace/collections/test_schema_google_calendar.ts` — 新しい2つが map でき、
  生の `conferenceData` / `attendees` は今までどおり弾かれること
- `test/services/google/test_calendarPushPlan.ts` — pull-only の一覧に2つを追加
