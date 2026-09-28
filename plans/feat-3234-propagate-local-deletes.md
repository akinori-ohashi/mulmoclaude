# ローカル削除を Google Calendar に伝播する（#3234）

#2620 の項目6。コレクション側が一次情報のカレンダー（#2620 の「ケース A」）で、
コレクションでレコードを消しても Google に残り、次の pull で復活して見える。

@michiof さんの優先度は「低」（「手で消せば足りる」）。不可逆なので既定は off で確定。

## 採った案（issue の案 A + ベースライン掃除）

- `googleCalendar` ブロックに `propagateDeletes`。**未指定 = 現行どおり削除しない**
- 有効でも、**参加者のいるイベントは対象外**にして報告に回す
- 削除に成功したらベースライン（`.push-state.json`）の該当エントリも消す → 報告が止まる

## 決めごと（issue のチェックリストへの回答）

1. **キー名** — `propagateDeletes`。`autoPush` と揃えず別のキーにしたのは、
   `autoPush` が「いつ書くか」を変えるのに対し、これは「書いた結果が取り消せない」を
   変えるから。サイズの違う決定を1つのフラグにまとめない
2. **安全弁は参加者の有無だけか** — **参加者の有無だけ**。organizer は見ない。
   `attendees` が1件でもあれば拒否する（Google が organizer 用に入れる要素も数える）。
   「自分だけ」を除こうとすると、どの要素が自分かを payload から判断する必要があり、
   外すと本物の招待を取り下げることになる。この機能が対象にしている単独の予定は
   `attendees` を持たないので、雑な規則でコストは無い
3. **削除前に確認を挟むか** — **挟まない**。理由は2つ:
   - `schema.json` に書く**オプトインそのものが確認**であり、エージェントは
     help doc で「足す前にユーザーに聞く」よう指示されている
   - `autoPush` の定期実行経路には人が居ないので、都度確認は成立しない
4. **`localDeletes` の毎回報告（issue の案 D）** — **伝播しない設定では直さない**。
   伝播せずにベースラインだけ消すと、Google に予定が残ったまま報告が止まる。
   報告はユーザーが食い違いを知る唯一の手段なので、消さない。
   伝播した場合と、Google 側に既に無い場合だけエントリを落とす
5. **取り消しの余地を残すか** — **残さない**。アプリ側に削除内容のコピーは持たない。
   Google Calendar 自身のゴミ箱が回復経路で、help doc にそう書いた。
   ログも id のみ（summary は個人の内容なので既存の規約どおり出さない）

## 実装

- `packages/core/src/google/deletePlan.ts`（新規・純粋）— `planDelete` / `deleteRefusalMessage`
- `collectionPush.ts` の `sweepDeletes` — 効果3つ（fetch / delete / forget）を
  引数で受けるので、grant もワークスペースも無しでテストできる
- `FetchedCalendarEvent` に `attendeeCount`。summary ではなくここに置いたのは、
  読むのが delete guard だけで、かつ**レコードからは取れない**（その時点でレコードは
  無い）ため
- 結果に `deletedInGoogle`。`localDeletes` は「こちらで何件消えたか」のままで、
  伝播の有無で意味が変わらない

## 検証

- `test/services/google/test_calendarDeletePlan.ts` — guard を両方向で
- `test/services/google/test_calendarDeleteSweep.ts` — **ベースラインの扱いが本体**。
  成功したら落とす / 拒否したら残す / 既に無ければ落とす / 失敗したら残す
- `test/workspace/collections/test_schema_google_calendar.ts` — 既定が undefined
- `e2e-live/tests/calendar-push.spec.ts` の L-GCAL-09 — 同じカレンダーに対して
  **オプトイン有りと無しの2つのワークスペース**を立て、無しでは残る／有りでは消える、
  を対照付きで見る。実行には grant と使い捨てカレンダーが要る（#2602 と同じ）

**参加者ありの拒否は live では確かめていない。** 確かめるには `createCalendarEvent` に
`attendees` を書けるようにする必要があり、テストのためだけに本番 API の書き込み面を
広げることになる。unit で両方向を押さえるに留めた。
