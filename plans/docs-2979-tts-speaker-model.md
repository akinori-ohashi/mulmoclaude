# docs(helps): 話者ごとの TTS `model` と、その周辺の「黙って既定に落ちる」挙動を helps に書く (#2979)

## 出発点（#2979 の指摘）

`speechParams.speakers.<name>.model` は指定できるのに helps に記載が無く、
`helps/gemini.md` は既定モデル名を仕様のように書いている。書き忘れても
エラーにならないので、テンプレート起点で量産したスクリプトは全部既定モデルで録音される。

提案は 2 点（`mulmoscript.md` の例に `model` を 1 行足す / `gemini.md:18` の書きぶりを直す）。

## 実装（`mulmocast@2.12.0` を実際に動かして確認）

`node_modules/mulmocast` を読むだけでなく、`mulmoPresentationStyleSchema.parse` +
`MulmoPresentationStyleMethods.getSpeakerData` を実行して解決結果を確認した。

| 確認したこと | 結果 |
|---|---|
| `speakerDataSchema.model` | `z.string().optional()` — provider の `models` 配列との照合は無い |
| `model` 省略時 | `tts_gemini_agent.js` が `model ?? provider2TTSAgent.gemini.defaultModel` で既定へ |
| **`provider` 省略時** | `text2SpeechProviderSchema` の `.default("openai")` で **openai** になる（gemini ではない） |
| **`lang` マップ** | `getSpeakerData` は `return speaker.lang[lang]` — **マージではなく置換**。`{ voiceId }` だけの言語エントリは provider が openai に落ちる |
| `speechOptions.instruction` | gemini / openai は使う。**google は `model` が無いと黙って捨てる**（`useGeminiPrompt = Boolean(model && instructions)`） |
| `speechOptions.speed` | openai / google / elevenlabs のみ。**gemini agent は params から受け取らない**＝黙って無視 |
| `beats[].speechOptions` | `{...speaker.speechOptions, ...beat.speechOptions}` — こちらは**マージ** |
| 音声キャッシュ | `text + voiceId + instruction + speed + provider + model + …` のハッシュがファイル名（`lib/actions/audio.js`）。**後から `model` を足すと全ビート録り直し** |
| Gemini TTS のモデル | `gemini-2.5-flash-preview-tts`（既定） / `gemini-2.5-pro-preview-tts`。`modelPricing` 上は pro が flash のちょうど 2 倍 |

実行結果（`getSpeakerData`）:

```text
Presenter/en : {"provider":"gemini","voiceId":"Kore","model":"gemini-2.5-pro-preview-tts",...}
Presenter/ja : {"provider":"openai","voiceId":"Zephyr"}      ← lang エントリが置換して provider が openai へ
NoProvider   : {"provider":"openai","voiceId":"Kore"}
```

## 提案より広げた理由：**mulmoscript.md はエージェントがテンプレートを写す先ではない**

`src/config/roles.ts` がロールに読ませているのは
`config/helps/presentation-deck.md` / `storyteller.md` / `business.md` の 3 本で、
`mulmoscript.md` は index とエラー時 fallback からしか参照されない。
`mulmoscript.md` だけ直しても、生成されるスクリプトに `model` は入らないまま。

→ **リファレンスは `mulmoscript.md` に厚く書き、テンプレート 3 本には
「いつ触るか + どこを読むか」の 1〜2 行だけ置く**構成にする。

## やること

1. `helps/mulmoscript.md` の `## speechParams` を話者リファレンスに書き直す
   - 話者フィールド表（`voiceId` / `provider` / `model` / `isDefault` / `displayName` / `speechOptions` / `lang`）
   - `provider` 省略＝openai、`model` 省略＝provider 既定、という**フォールバックを明示**
   - モデル選択表（flash 既定 / pro は約 2 倍）と「**最初のレンダリング前に決める**」（キャッシュキー）
   - `speechOptions` の provider 別対応表（gemini は `speed` を無視）とビート単位のマージ
   - `lang` は**置換**であることと、`provider` / `model` / `speechOptions` を書き直す例
2. `helps/gemini.md` — 既定モデルと話者ごとの上書きが読み取れる書き方へ
3. テンプレート 3 本（`storyteller.md` / `presentation-deck.md` / `business.md`）に短い注記
4. `helps/error-recovery.md` に「ナレーションが違う声 / 指示が効かない / 全ビート録り直し」の節を追加
   （CLAUDE.md: 実行時に踏む失敗はここに書く）

## やらないこと（理由）

- **テンプレートに `"model"` を既定値で埋め込まない**。`*-preview-tts` は preview 名で、
  埋め込むと Google 側の引退時に生成済みスクリプト全部が死んだ名前を抱える。
  既定に任せれば mulmocast の更新に追従できる。「上書きしたい時だけ足す」を文書化する方を選ぶ。
- **`packages/plugins/mulmoscript-plugin` の tool description は触らない**。毎リクエストのトークンで、
  ここに書く価値があるのは全スクリプト共通の規則だけ。model / lang は条件付きなので helps 側が適切。
- **`@mulmoclaude/core` の version bump はしない**（直近の helps 変更コミットも bump していない）。
  npm 配布は次の core リリースに乗る。PR の Items to Confirm で確認する。
